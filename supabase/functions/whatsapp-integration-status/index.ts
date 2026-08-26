import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { getWhatsAppConfig } from "../_shared/whatsapp-embedded.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error } = await supabaseAdmin
      .from("crm_whatsapp_connections")
      .select(
        "id,business_id,waba_id,business_name,status,webhook_subscribed,phone_registered,connected_at,last_health_check_at,last_error,token_expires_at",
      )
      .eq("id_empresa", crmUser.id_empresa)
      .neq("status", "disconnected")
      .maybeSingle();
    if (error) throw new Error(error.message);

    let phone = null;
    if (connection) {
      const { data, error: phoneError } = await supabaseAdmin
        .from("crm_whatsapp_phone_numbers")
        .select(
          "phone_number_id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_status",
        )
        .eq("connection_id", connection.id)
        .eq("active", true)
        .maybeSingle();
      if (phoneError) throw new Error(phoneError.message);
      phone = data;
    }

    let configured = true;
    try {
      getWhatsAppConfig(true);
    } catch {
      configured = false;
    }

    return jsonResponse({ configured, connection: connection ?? null, phone });
  });
});
