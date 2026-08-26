import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { decryptSecret, getWhatsAppConfig, graphRequest } from "../_shared/whatsapp-embedded.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error } = await supabaseAdmin
      .from("crm_whatsapp_connections")
      .select("id,waba_id,access_token_ciphertext")
      .eq("id_empresa", crmUser.id_empresa)
      .neq("status", "disconnected")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!connection) return jsonResponse({ ok: true });

    let unsubscribeError: string | null = null;
    try {
      const config = getWhatsAppConfig(true);
      const token = await decryptSecret(connection.access_token_ciphertext, config.encryptionKey);
      await graphRequest<{ success: boolean }>(
        config,
        `${connection.waba_id}/subscribed_apps`,
        token,
        { method: "DELETE" },
      );
    } catch (externalError) {
      unsubscribeError =
        externalError instanceof Error ? externalError.message : "Falha ao remover assinatura";
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("crm_whatsapp_connections")
      .update({
        status: "disconnected",
        webhook_subscribed: false,
        disconnected_at: now,
        last_error: unsubscribeError,
        updated_at: now,
      })
      .eq("id", connection.id);
    if (updateError) throw new Error(updateError.message);

    const { error: phoneError } = await supabaseAdmin
      .from("crm_whatsapp_phone_numbers")
      .update({ active: false, updated_at: now })
      .eq("connection_id", connection.id);
    if (phoneError) throw new Error(phoneError.message);

    return jsonResponse({ ok: true, warning: unsubscribeError });
  });
});
