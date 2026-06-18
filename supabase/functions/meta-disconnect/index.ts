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
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();

    const { error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .update({ active: false })
      .eq("id_empresa", crmUser.id_empresa);
    if (connectionError) throw new Error(connectionError.message);

    const { error: formsError } = await supabaseAdmin
      .from("crm_meta_forms")
      .update({ active: false })
      .eq("id_empresa", crmUser.id_empresa);
    if (formsError) throw new Error(formsError.message);

    return jsonResponse({ ok: true });
  });
});
