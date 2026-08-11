import {
  createSupabaseAdmin,
  fetchGraphCollection,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  createMetaFieldValueMap,
  getMappedMetaValue,
  normalizeBrazilPhone,
  type MetaLeadFieldData,
} from "../_shared/meta-lead.ts";
import { resolveLeadOrigin } from "../_shared/lead-origin.ts";

type MetaLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: MetaLeadFieldData[];
};

async function getRouting(
  supabaseAdmin: ReturnType<typeof createSupabaseAdmin>,
  idEmpresa: number,
  funnelId: number,
) {
  const [{ data: manager, error: managerError }, { data: stage, error: stageError }] =
    await Promise.all([
      supabaseAdmin
        .from("crm_users")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("role", "manager")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("crm_stages")
        .select("id")
        .eq("id_empresa", idEmpresa)
        .eq("id_funnel", funnelId)
        .eq("ativo", true)
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
  if (managerError) throw new Error(managerError.message);
  if (stageError) throw new Error(stageError.message);
  return { assignedTo: manager?.id ?? null, stageId: stage?.id ?? null };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { limitPerForm = 100 } = (await req.json().catch(() => ({}))) as {
      limitPerForm?: number;
    };
    const safeLimit = Math.min(Math.max(Number(limitPerForm) || 100, 1), 500);
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

    const { data: forms, error: formsError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("form_id,page_access_token,id_empreendimento,id_funnel")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("connection_id", connection.id)
      .eq("active", true)
      .not("id_empreendimento", "is", null)
      .not("id_funnel", "is", null);
    if (formsError) throw new Error(formsError.message);

    let checked = 0;
    let recovered = 0;
    let duplicates = 0;
    const failed: Array<{ formId: string; leadId?: string; message: string }> = [];

    for (const form of forms ?? []) {
      try {
        const accessToken = form.page_access_token || connection.user_access_token;
        const url = new URL(
          `https://graph.facebook.com/${graphVersion}/${form.form_id}/leads`,
        );
        url.searchParams.set("fields", "id,created_time,ad_id,form_id,field_data");
        url.searchParams.set("limit", String(safeLimit));
        url.searchParams.set("access_token", accessToken);
        const leads = (await fetchGraphCollection<MetaLead>(url)).slice(0, safeLimit);

        const { data: mappings, error: mappingError } = await supabaseAdmin
          .from("crm_meta_field_mapping")
          .select("meta_field_key,crm_field")
          .eq("id_empresa", crmUser.id_empresa)
          .eq("form_id", form.form_id);
        if (mappingError) throw new Error(mappingError.message);
        const mapping = Object.fromEntries(
          (mappings ?? []).map((item) => [item.meta_field_key, item.crm_field]),
        );
        const routing = await getRouting(
          supabaseAdmin,
          crmUser.id_empresa,
          Number(form.id_funnel),
        );

        for (const lead of leads) {
          checked += 1;
          try {
            const values = createMetaFieldValueMap(lead.field_data ?? []);
            const nome = getMappedMetaValue({ values, mapping, crmField: "nome" }).trim();
            const phone = normalizeBrazilPhone(
              getMappedMetaValue({ values, mapping, crmField: "telefone" }).trim(),
            );
            if (!nome || !phone.normalized) {
              throw new Error("Lead sem nome ou telefone conforme o mapeamento atual");
            }
            const email =
              getMappedMetaValue({ values, mapping, crmField: "email" }).trim() || null;
            const origem = resolveLeadOrigin(
              getMappedMetaValue({ values, mapping, crmField: "origem" }),
              "FB",
            );
            const observacoes =
              getMappedMetaValue({ values, mapping, crmField: "observacoes" }).trim() || null;
            const { data: ingestion, error: ingestionError } = await supabaseAdmin.rpc(
              "crm_ingest_meta_lead",
              {
                p_id_empresa: crmUser.id_empresa,
                p_form_id: form.form_id,
                p_lead_id_meta: lead.id,
                p_nome: nome,
                p_email: email,
                p_telefone: phone.normalized,
                p_raw_data: {
                  source: "meta_recovery",
                  lead,
                  recovered_at: new Date().toISOString(),
                  destination: {
                    id_empresa: crmUser.id_empresa,
                    id_empreendimento: form.id_empreendimento,
                    id_funnel: form.id_funnel,
                  },
                },
                p_origem: origem,
                p_observacoes: observacoes,
                p_id_empreendimento: form.id_empreendimento,
                p_crm_stage_id: routing.stageId,
                p_crm_assigned_to: routing.assignedTo,
              },
            );
            if (ingestionError) throw new Error(ingestionError.message);
            const result = Array.isArray(ingestion) ? ingestion[0] : ingestion;
            if (result?.was_inserted) recovered += 1;
            else duplicates += 1;
          } catch (error) {
            failed.push({
              formId: form.form_id,
              leadId: lead.id,
              message: error instanceof Error ? error.message : "Falha ao recuperar lead",
            });
          }
        }

        await supabaseAdmin
          .from("crm_meta_forms")
          .update({ last_recovered_at: new Date().toISOString() })
          .eq("id_empresa", crmUser.id_empresa)
          .eq("form_id", form.form_id);
      } catch (error) {
        failed.push({
          formId: form.form_id,
          message: error instanceof Error ? error.message : "Falha ao consultar formulario",
        });
      }
    }

    if (failed.length > 0) {
      await supabaseAdmin
        .from("crm_meta_connections")
        .update({
          health_status: "degraded",
          last_health_check_at: new Date().toISOString(),
          last_error: failed.map((item) => `${item.formId}: ${item.message}`).join(" | ").slice(0, 2000),
        })
        .eq("id", connection.id)
        .eq("id_empresa", crmUser.id_empresa);
    }

    return jsonResponse({
      forms: forms?.length ?? 0,
      checked,
      recovered,
      duplicates,
      failed,
    });
  });
});
