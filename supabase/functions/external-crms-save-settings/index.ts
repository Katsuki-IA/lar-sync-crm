import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

function asOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const body = (await req.json()) as {
      provider?: string;
      rdFunnelId?: unknown;
      rdFunnelName?: unknown;
      rdStageId?: unknown;
      rdStageName?: unknown;
    };
    if (body.provider !== "rd_station") throw new Error("Provedor não suportado");

    const rdFunnelId = asOptionalText(body.rdFunnelId);
    const rdFunnelName = asOptionalText(body.rdFunnelName);
    const rdStageId = asOptionalText(body.rdStageId);
    const rdStageName = asOptionalText(body.rdStageName);

    if (!rdFunnelId && !rdFunnelName) {
      throw new Error("Informe o funil de destino no RD Station");
    }

    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const settings = {
      rd_funnel_id: rdFunnelId,
      rd_funnel_name: rdFunnelName,
      rd_stage_id: rdStageId,
      rd_stage_name: rdStageName,
    };

    const { data, error } = await supabaseAdmin
      .from("crm_external_crm_connections")
      .update({ settings, active: true, last_error: null })
      .eq("id_empresa", crmUser.id_empresa)
      .eq("provider", "rd_station")
      .select("id,provider,provider_label,account_id,account_name,settings,active,connected_at,last_error")
      .single();
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, connection: data });
  });
});
