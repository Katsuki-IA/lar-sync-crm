import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { provider } = (await req.json()) as { provider?: string };
    if (provider !== "rd_station") throw new Error("Provedor não suportado");

    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("crm_external_crm_connections")
      .update({
        active: false,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        last_error: null,
      })
      .eq("id_empresa", crmUser.id_empresa)
      .eq("provider", provider);
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true });
  });
});
