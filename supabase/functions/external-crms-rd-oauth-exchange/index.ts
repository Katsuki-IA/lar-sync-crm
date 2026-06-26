import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  exchangeRdAuthorizationCode,
  getRdDestinationConfig,
  verifyRdDestinationSignedState,
} from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { code, state } = (await req.json()) as { code?: string; state?: string };
    if (!code || !state) throw new Error("Retorno OAuth do RD Station incompleto");

    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const { clientSecret } = getRdDestinationConfig();
    await verifyRdDestinationSignedState({
      state,
      expectedUserId: userId,
      expectedEmpresa: crmUser.id_empresa,
      secret: clientSecret,
    });

    const tokens = await exchangeRdAuthorizationCode(code);
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("crm_external_crm_connections")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          provider: "rd_station",
          provider_label: "RD Station CRM",
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.tokenExpiresAt,
          active: true,
          connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "id_empresa,provider" },
      )
      .select("id,provider,provider_label,account_id,account_name,settings,active,connected_at,last_error")
      .single();
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, connection: data });
  });
});
