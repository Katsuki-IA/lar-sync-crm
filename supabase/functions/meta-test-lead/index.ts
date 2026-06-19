import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeBrazilPhone(value: string) {
  const digits = digitsOnly(value);
  if (!digits) {
    return { original: value, digits, normalized: "" };
  }

  let nationalNumber = digits;
  if (nationalNumber.startsWith("55") && nationalNumber.length > 11) {
    nationalNumber = nationalNumber.slice(2);
  }
  if (nationalNumber.startsWith("0") && nationalNumber.length > 10) {
    nationalNumber = nationalNumber.slice(1);
  }

  return {
    original: value,
    digits,
    normalized: `55 ${nationalNumber}`,
  };
}

function getMappedValue(args: {
  fieldValues: Record<string, string>;
  mapping: Record<string, string>;
  crmField: string;
}) {
  const metaField = Object.entries(args.mapping).find(([, crmField]) => crmField === args.crmField);
  if (!metaField) return "";
  return args.fieldValues[metaField[0]]?.trim() ?? "";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { formId, fieldValues } = (await req.json()) as {
      formId?: string;
      fieldValues?: Record<string, string>;
    };

    if (!formId || typeof formId !== "string") {
      throw new Error("Formulário Meta ausente");
    }
    if (!fieldValues || typeof fieldValues !== "object") {
      throw new Error("Valores de teste ausentes");
    }

    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: form, error: formError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("form_id,form_name,page_id,page_name")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", formId)
      .eq("active", true)
      .maybeSingle();
    if (formError) throw new Error(formError.message);
    if (!form) throw new Error("Formulário não encontrado para esta empresa");

    const { data: mappings, error: mappingError } = await supabaseAdmin
      .from("crm_meta_field_mapping")
      .select("meta_field_key,crm_field")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", form.form_id);
    if (mappingError) throw new Error(mappingError.message);

    const mapping = Object.fromEntries(
      (mappings ?? []).map((item) => [item.meta_field_key, item.crm_field]),
    );

    const nome = getMappedValue({ fieldValues, mapping, crmField: "nome" }) || "Lead Teste Meta";
    const telefoneOriginal = getMappedValue({ fieldValues, mapping, crmField: "telefone" });
    const telefoneNormalizado = normalizeBrazilPhone(telefoneOriginal);
    const telefone =
      telefoneNormalizado.normalized ||
      `55 1199${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const email = getMappedValue({ fieldValues, mapping, crmField: "email" }) || null;
    const observacoes = getMappedValue({ fieldValues, mapping, crmField: "observacoes" }) || null;
    const origem = getMappedValue({ fieldValues, mapping, crmField: "origem" }) || "Meta Lead Ads";

    const { data: crmUserRow, error: crmUserError } = await supabaseAdmin
      .from("crm_users")
      .select("id")
      .eq("auth_user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (crmUserError) throw new Error(crmUserError.message);

    const { data: defaultFunnel } = await supabaseAdmin
      .from("crm_funnels")
      .select("id")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("is_default", true)
      .maybeSingle();

    let defaultStageId: number | null = null;
    const stagesQuery = supabaseAdmin
      .from("crm_stages")
      .select("id")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("ativo", true)
      .order("ordem", { ascending: true })
      .limit(1);
    if (defaultFunnel?.id) stagesQuery.eq("id_funnel", defaultFunnel.id);
    const { data: stage } = await stagesQuery.maybeSingle();
    defaultStageId = stage?.id ?? null;

    const metaLeadId = `test_${form.form_id}_${crypto.randomUUID()}`;
    const rawData = {
      test: true,
      source: "internal_simulator",
      form_id: form.form_id,
      form_name: form.form_name,
      page_id: form.page_id,
      page_name: form.page_name,
      field_data: Object.entries(fieldValues).map(([name, value]) => ({
        name,
        values: [value],
      })),
      normalized_fields: {
        telefone: {
          original: telefoneNormalizado.original || null,
          digits: telefoneNormalizado.digits || null,
          normalized: telefoneNormalizado.normalized || telefone,
          default_country_code: "55",
        },
      },
    };

    const { error: metaLeadError } = await supabaseAdmin.from("crm_meta_leads").insert({
      id_empresa: crmUser.id_empresa,
      form_id: form.form_id,
      lead_id_meta: metaLeadId,
      nome,
      email,
      telefone,
      raw_data: rawData,
    });
    if (metaLeadError) throw new Error(metaLeadError.message);

    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .insert({
        id_empresa: crmUser.id_empresa,
        nome,
        telefone,
        email,
        origem,
        observacoes,
        crm_stage_id: defaultStageId,
        crm_assigned_to: crmUserRow?.id ?? null,
      })
      .select("id")
      .single();
    if (leadError) throw new Error(leadError.message);

    await supabaseAdmin.from("crm_lead_activities").insert({
      lead_id: lead.id,
      crm_user_id: crmUserRow?.id ?? null,
      tipo: "system",
      descricao: `Lead teste criado via integração Meta (${form.form_name ?? form.form_id})`,
    });

    return jsonResponse({ ok: true, leadId: lead.id, metaLeadId });
  });
});
