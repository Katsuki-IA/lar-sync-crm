import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { recoverMetaLeadsForForm } from "../_shared/meta-recovery.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const body = (await req.json().catch(() => ({}))) as {
      formId?: string;
      since?: string;
      until?: string;
      limitPerForm?: number;
    };
    if (!body.formId?.trim()) throw new Error("Selecione um formulario para recuperar");
    const since = new Date(body.since ?? "");
    const until = new Date(body.until ?? "");
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
      throw new Error("Informe o periodo inicial e final da recuperacao");
    }
    if (until < since) throw new Error("A data final deve ser posterior a data inicial");
    if (until.getTime() - since.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new Error("O periodo maximo por recuperacao e de 31 dias");
    }

    const { crmUser } = await getAuthorizedCrmUser(req);
    const { graphVersion } = getMetaConfig(false);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("crm_meta_connections")
      .select("id,user_access_token")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);
    if (!connection) throw new Error("Nenhuma conta Meta conectada para esta empresa");

    const { data: form, error: formError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("form_id,page_id,page_access_token,id_empreendimento,id_funnel")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("connection_id", connection.id)
      .eq("form_id", body.formId.trim())
      .eq("active", true)
      .not("id_empreendimento", "is", null)
      .not("id_funnel", "is", null)
      .maybeSingle();
    if (formError) throw new Error(formError.message);
    if (!form) throw new Error("Formulario nao configurado para esta empresa");

    const result = await recoverMetaLeadsForForm({
      supabaseAdmin,
      idEmpresa: crmUser.id_empresa,
      connectionId: connection.id,
      userAccessToken: connection.user_access_token,
      graphVersion,
      form,
      since,
      until,
      limit: Math.min(Math.max(Number(body.limitPerForm) || 500, 1), 500),
    });
    if (result.failed.length > 0) {
      await supabaseAdmin
        .from("crm_meta_connections")
        .update({
          health_status: "degraded",
          last_health_check_at: new Date().toISOString(),
          last_error: result.failed
            .map((item) => `${item.formId}: ${item.message}`)
            .join(" | ")
            .slice(0, 2000),
        })
        .eq("id", connection.id)
        .eq("id_empresa", crmUser.id_empresa);
    }
    return jsonResponse({ forms: 1, ...result });
  });
});
