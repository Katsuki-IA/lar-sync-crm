import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  createRdWebhook,
  exchangeRdAuthorizationCode,
  getRdConfig,
  sha256Hex,
  verifyRdSignedState,
} from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { code, state } = (await req.json()) as { code?: string; state?: string };
    if (!code || !state) throw new Error("Retorno OAuth do RD Station incompleto");

    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const { clientSecret, supabaseUrl } = getRdConfig();
    const { empreendimentoId, funnelId } = await verifyRdSignedState({
      state,
      expectedUserId: userId,
      expectedEmpresa: crmUser.id_empresa,
      secret: clientSecret,
    });

    const tokens = await exchangeRdAuthorizationCode(code);
    const webhookSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const callbackUrl = `${supabaseUrl}/functions/v1/rd-webhook?token=${webhookSecret}`;
    const webhook = await createRdWebhook(tokens.accessToken, callbackUrl);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: connection, error } = await supabaseAdmin
      .from("crm_rd_connections")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.tokenExpiresAt,
          platform_account_id: webhook.platformAccountId,
          webhook_uuid: webhook.webhookUuid,
          webhook_secret_hash: await sha256Hex(webhookSecret),
          default_id_empreendimento: empreendimentoId,
          default_id_funnel: funnelId,
          connected_at: new Date().toISOString(),
          active: true,
          last_error: null,
        },
        { onConflict: "id_empresa" },
      )
      .select("id,platform_account_id,connected_at,active,default_id_empreendimento,default_id_funnel")
      .single();
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, connection });
  });
});
