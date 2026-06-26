import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

const PROVIDERS = [
  { provider: "rd_station", label: "RD Station CRM", available: true },
  { provider: "cv_crm", label: "CV CRM", available: false },
  { provider: "c2s", label: "C2S", available: false },
  { provider: "kommo", label: "Kommo", available: false },
  { provider: "loft", label: "Loft", available: false },
  { provider: "custom", label: "API personalizada", available: false },
] as const;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("crm_external_crm_connections")
      .select("id,provider,provider_label,account_id,account_name,settings,active,connected_at,last_error")
      .eq("id_empresa", crmUser.id_empresa)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const byProvider = new Map((data ?? []).map((item) => [item.provider, item]));
    const providers = PROVIDERS.map((item) => ({
      ...item,
      connection: byProvider.get(item.provider) ?? null,
    }));

    return jsonResponse({ providers });
  });
});
