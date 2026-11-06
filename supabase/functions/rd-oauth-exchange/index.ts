import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  createRdWebhook,
  deleteRdWebhook,
  exchangeRdAuthorizationCode,
  getRdStateConfig,
  getValidRdAccessToken,
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
    const config = getRdStateConfig(state);
    const { clientSecret, supabaseUrl } = config;
    const { empreendimentoId, funnelId } = await verifyRdSignedState({
      state,
      expectedUserId: userId,
      expectedEmpresa: crmUser.id_empresa,
      secret: clientSecret,
    });

    const supabaseAdmin = createSupabaseAdmin();
    const { data: previous, error: previousError } = await supabaseAdmin
      .from("crm_rd_connections")
      .select("id,access_token,refresh_token,token_expires_at,webhook_uuid,oauth_client_id")
      .eq("id_empresa", crmUser.id_empresa)
      .maybeSingle();
    if (previousError) throw new Error(previousError.message);
    // Resolve the old app before replacing its tokens. If it cannot be refreshed,
    // leave the existing connection untouched for an explicit recovery.
    const previousAccessToken = previous?.webhook_uuid
      ? await getValidRdAccessToken(previous)
      : null;
    const tokens = await exchangeRdAuthorizationCode(code, config);
    const webhookSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const callbackUrl = `${supabaseUrl}/functions/v1/rd-webhook?token=${webhookSecret}`;
    const webhook = await createRdWebhook(tokens.accessToken, callbackUrl);

    const { data: connection, error } = await supabaseAdmin
      .from("crm_rd_connections")
      .upsert(
        {
          id_empresa: crmUser.id_empresa,
          oauth_client_id: config.clientId,
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
    if (error) {
      await deleteRdWebhook(tokens.accessToken, webhook.webhookUuid).catch(() => {
        console.warn("Falha ao limpar novo webhook RD após erro ao salvar conexão");
      });
      throw new Error(error.message);
    }

    let warning: string | null = null;
    if (previousAccessToken && previous?.webhook_uuid && previous.webhook_uuid !== webhook.webhookUuid) {
      try {
        await deleteRdWebhook(previousAccessToken, previous.webhook_uuid);
      } catch {
        warning = "Nova conexão salva; o webhook anterior precisa ser removido no RD Station.";
        await supabaseAdmin.from("crm_rd_connections")
          .update({ last_error: warning }).eq("id", connection.id);
      }
    }

    return jsonResponse({ ok: true, connection, warning });
  });
});
