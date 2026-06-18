import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  syncMetaFormsForConnection,
  withErrorHandling,
} from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { graphVersion } = getMetaConfig(false);
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: connection, error } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_access_token")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!connection) throw new Error("Nenhuma conta Meta conectada");

    const sync = await syncMetaFormsForConnection({
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: connection.user_access_token,
      graphVersion,
    });

    return jsonResponse(sync);
  });
});
