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

    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_name,user_id_meta,connected_at,active")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);

    const { data: forms, error: formsError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("id,form_id,form_name,page_id,page_name,leads_count,active")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .order("page_name", { ascending: true });
    if (formsError) throw new Error(formsError.message);

    return jsonResponse({
      connection: connection ?? null,
      forms: forms ?? [],
    });
  });
});
