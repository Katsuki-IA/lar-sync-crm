import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { deleteRdWebhook, getValidRdAccessToken } from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_rd_connections")
      .select("id,access_token,refresh_token,token_expires_at,webhook_uuid")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);
    if (!connection) return jsonResponse({ ok: true, warning: null });

    let warning: string | null = null;
    if (connection.webhook_uuid) {
      try {
        const accessToken = await getValidRdAccessToken(connection);
        await deleteRdWebhook(accessToken, connection.webhook_uuid);
      } catch (error) {
        warning = error instanceof Error ? error.message : "Não foi possível remover o webhook na RD";
        console.warn("Falha ao remover webhook RD durante desconexão", error);
      }
    }

    const { error } = await supabaseAdmin
      .from("crm_rd_connections")
      .update({
        active: false,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        webhook_uuid: null,
        webhook_secret_hash: null,
        last_error: warning,
      })
      .eq("id", connection.id);
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, warning });
  });
});
