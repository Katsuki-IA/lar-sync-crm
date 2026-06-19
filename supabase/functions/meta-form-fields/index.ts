import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

type MetaQuestion = {
  id?: string;
  key?: string;
  label?: string;
  type?: string;
};

function normalizeQuestion(question: MetaQuestion, index: number) {
  const key = question.key ?? question.id ?? `field_${index + 1}`;
  return {
    key,
    label: question.label ?? question.key ?? question.id ?? key,
    type: question.type ?? null,
  };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { formId } = (await req.json()) as { formId?: string };
    if (!formId || typeof formId !== "string") {
      throw new Error("Formulário Meta ausente");
    }

    const { crmUser } = await getAuthorizedCrmUser(req);
    const { graphVersion } = getMetaConfig(false);
    const supabaseAdmin = createSupabaseAdmin();

    const { data: form, error: formError } = await supabaseAdmin
      .from("crm_meta_forms")
      .select("form_id,form_name,page_id,page_name,page_access_token,connection_id,id_empreendimento")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", formId)
      .eq("active", true)
      .maybeSingle();

    if (formError) throw new Error(formError.message);
    if (!form) throw new Error("Formulário não encontrado para esta empresa");

    let accessToken = form.page_access_token as string | null;
    if (!accessToken) {
      const { data: connection, error: connectionError } = await supabaseAdmin
        .from("crm_meta_connections")
        .select("user_access_token")
        .eq("id_empresa", crmUser.id_empresa)
        .eq("id", form.connection_id)
        .eq("active", true)
        .maybeSingle();
      if (connectionError) throw new Error(connectionError.message);
      accessToken = connection?.user_access_token ?? null;
    }
    if (!accessToken) throw new Error("Token de acesso da página não encontrado");

    const formUrl = new URL(`https://graph.facebook.com/${graphVersion}/${form.form_id}`);
    formUrl.searchParams.set("fields", "id,name,questions");
    formUrl.searchParams.set("access_token", accessToken);
    const formRes = await fetch(formUrl.toString());
    const formJson = await formRes.json();
    if (!formRes.ok || formJson.error) {
      throw new Error(formJson?.error?.message ?? "Falha ao buscar campos do formulário Meta");
    }

    const questionsRaw = Array.isArray(formJson?.questions?.data)
      ? formJson.questions.data
      : Array.isArray(formJson?.questions)
        ? formJson.questions
        : [];
    const fields = questionsRaw.map((question: MetaQuestion, index: number) =>
      normalizeQuestion(question, index),
    );

    const { data: mappings, error: mappingError } = await supabaseAdmin
      .from("crm_meta_field_mapping")
      .select("meta_field_key,crm_field")
      .eq("id_empresa", crmUser.id_empresa)
      .eq("form_id", form.form_id);
    if (mappingError) throw new Error(mappingError.message);

    const mapping = Object.fromEntries(
      (mappings ?? []).map((item) => [item.meta_field_key, item.crm_field]),
    );

    const { data: empreendimentos, error: empreendimentosError } = await supabaseAdmin
      .from("empreendimento")
      .select("id,nome")
      .eq("id_empresa", crmUser.id_empresa)
      .order("nome", { ascending: true });
    if (empreendimentosError) throw new Error(empreendimentosError.message);

    return jsonResponse({
      form: {
        form_id: form.form_id,
        form_name: form.form_name ?? null,
        page_id: form.page_id,
        page_name: form.page_name ?? null,
        id_empreendimento: form.id_empreendimento ?? null,
      },
      empreendimentos: empreendimentos ?? [],
      fields,
      mapping,
    });
  });
});
