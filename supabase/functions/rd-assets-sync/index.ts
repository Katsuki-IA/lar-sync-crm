import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { getValidRdAccessToken } from "../_shared/rd.ts";

type RdConversionAsset = {
  asset_identifier?: string;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function readRdError(response: Response) {
  const text = await response.text();
  if (!text) return "A RD Station não permitiu consultar formulários e landing pages";
  try {
    const payload = JSON.parse(text) as {
      error?: string;
      error_description?: string;
      errors?: { error_message?: string };
    };
    return (
      payload.errors?.error_message ??
      payload.error_description ??
      payload.error ??
      "A RD Station não permitiu consultar formulários e landing pages"
    );
  } catch {
    return text;
  }
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_rd_connections")
      .select("id,access_token,refresh_token,token_expires_at,default_id_funnel")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);
    if (!connection) throw new Error("Conexão RD Station não encontrada");

    const accessToken = await getValidRdAccessToken(connection);
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 44);

    const url = new URL("https://api.rd.services/platform/analytics/conversions");
    url.searchParams.set("start_date", formatDate(startDate));
    url.searchParams.set("end_date", formatDate(endDate));
    url.searchParams.append("assets_type[]", "LandingPage");
    url.searchParams.append("assets_type[]", "Forms");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(await readRdError(response));

    const payload = (await response.json()) as { conversions?: RdConversionAsset[] };
    const identifiers = Array.from(
      new Set(
        (payload.conversions ?? [])
          .map((asset) => asset.asset_identifier?.trim())
          .filter((identifier): identifier is string => Boolean(identifier)),
      ),
    );

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("crm_rd_source_mappings")
      .select("event_identifier")
      .eq("id_empresa", crmUser.id_empresa);
    if (existingError) throw new Error(existingError.message);
    const existingIdentifiers = new Set((existing ?? []).map((item) => item.event_identifier));
    const missing = identifiers.filter((identifier) => !existingIdentifiers.has(identifier));

    if (missing.length) {
      const { error: insertError } = await supabaseAdmin.from("crm_rd_source_mappings").insert(
        missing.map((eventIdentifier) => ({
          id_empresa: crmUser.id_empresa,
          connection_id: connection.id,
          event_identifier: eventIdentifier,
          id_empreendimento: null,
          id_funnel: connection.default_id_funnel ?? null,
          active: true,
        })),
      );
      if (insertError) throw new Error(insertError.message);
    }

    return jsonResponse({ ok: true, found: identifiers.length, created: missing.length });
  });
});
