import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

const ALLOWED_CRM_FIELDS = new Set([
  "nome",
  "telefone",
  "email",
  "origem",
  "observacoes",
]);

type MappingInput = {
  metaFieldKey?: string;
  crmField?: string;
};

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { formId, empreendimentoId, funnelId, mapping } = (await req.json()) as {
      formId?: string;
      empreendimentoId?: number;
      funnelId?: number;
      mapping?: MappingInput[];
    };

    if (!formId || typeof formId !== "string") {
      throw new Error("Formulário Meta ausente");
    }
    if (!Array.isArray(mapping)) {
      throw new Error("Mapeamento inválido");
    }
    if (!Number.isSafeInteger(empreendimentoId) || Number(empreendimentoId) <= 0) {
      throw new Error("Empreendimento inválido");
    }
    if (!Number.isSafeInteger(funnelId) || Number(funnelId) <= 0) {
      throw new Error("Funil inválido");
    }

    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: form, error: formError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("form_id")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", formId)
      .eq("active", true)
      .maybeSingle();

    if (formError) throw new Error(formError.message);
    if (!form) throw new Error("Formulário não encontrado para esta empresa");

    const { data: empreendimento, error: empreendimentoError } = await supabaseAdmin
      .from("empreendimento")
      .select("id")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("id", empreendimentoId)
      .maybeSingle();
    if (empreendimentoError) throw new Error(empreendimentoError.message);
    if (!empreendimento) throw new Error("Empreendimento não encontrado para esta empresa");

    const { data: funnel, error: funnelError } = await supabaseAdmin
      .from("crm_funnels")
      .select("id")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("id", funnelId)
      .eq("ativo", true)
      .maybeSingle();
    if (funnelError) throw new Error(funnelError.message);
    if (!funnel) throw new Error("Funil não encontrado para esta empresa");

    const rows = mapping
      .map((item) => ({
        meta_field_key: item.metaFieldKey?.trim() ?? "",
        crm_field: item.crmField?.trim() ?? "",
      }))
      .filter((item) => item.meta_field_key && item.crm_field && item.crm_field !== "__ignore__");

    for (const row of rows) {
      if (!ALLOWED_CRM_FIELDS.has(row.crm_field)) {
        throw new Error(`Campo CRM inválido: ${row.crm_field}`);
      }
    }

    const mappedCrmFields = new Set(rows.map((row) => row.crm_field));
    if (!mappedCrmFields.has("nome")) {
      throw new Error("Mapeie um campo da Meta para Nome");
    }
    if (!mappedCrmFields.has("telefone")) {
      throw new Error("Mapeie um campo da Meta para Telefone");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("crm_meta_field_mapping")
      .delete()
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", form.form_id);
    if (deleteError) throw new Error(deleteError.message);

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from("crm_meta_field_mapping").insert(
        rows.map((row) => ({
          id_empresa: crmUser.id_empresa,
          form_id: form.form_id,
          meta_field_key: row.meta_field_key,
          crm_field: row.crm_field,
        })),
      );
      if (insertError) throw new Error(insertError.message);
    }

    const { error: formUpdateError } = await supabaseAdmin
      .from("crm_meta_forms")
      .update({ id_empreendimento: empreendimento.id, id_funnel: funnel.id })
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", form.form_id);
    if (formUpdateError) throw new Error(formUpdateError.message);

    return jsonResponse({ ok: true });
  });
});
