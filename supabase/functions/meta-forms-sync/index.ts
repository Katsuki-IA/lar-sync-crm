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
    const body = (await req.json().catch(() => ({}))) as { pageIds?: unknown };
    const { graphVersion } = getMetaConfig(false);
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: connection, error } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_access_token,selected_page_ids")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!connection) throw new Error("Nenhuma conta Meta conectada");

    let selectedPageIds = (connection.selected_page_ids ?? []) as string[];
    if (body.pageIds !== undefined) {
      if (!Array.isArray(body.pageIds)) throw new Error("Seleção de páginas inválida");
      selectedPageIds = Array.from(
        new Set(
          body.pageIds
            .map((pageId) => String(pageId).trim())
            .filter((pageId) => /^\d+$/.test(pageId)),
        ),
      );
      if (selectedPageIds.length !== body.pageIds.length || selectedPageIds.length > 200) {
        throw new Error("Seleção de páginas inválida");
      }

      const { error: selectionError } = await supabaseAdmin
        .from("crm_meta_connections")
        .update({ selected_page_ids: selectedPageIds })
        .eq("id", connection.id)
        .eq("id_empresa", crmUser.id_empresa);
      if (selectionError) throw new Error(selectionError.message);
    }

    const sync = await syncMetaFormsForConnection({
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: connection.user_access_token,
      graphVersion,
      selectedPageIds,
    });

    return jsonResponse(sync);
  });
});
