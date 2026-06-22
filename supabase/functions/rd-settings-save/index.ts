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
    const { empreendimentoId } = (await req.json()) as { empreendimentoId?: number };
    if (!empreendimentoId || !Number.isInteger(empreendimentoId)) {
      throw new Error("Selecione o empreendimento padrão");
    }
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: empreendimento, error: empreendimentoError } = await supabaseAdmin
      .from("empreendimento")
      .select("id")
      .eq("id", empreendimentoId)
      .eq("id_empresa", crmUser.id_empresa)
      .maybeSingle();
    if (empreendimentoError) throw new Error(empreendimentoError.message);
    if (!empreendimento) throw new Error("Empreendimento não pertence à empresa atual");

    const { error } = await supabaseAdmin
      .from("crm_rd_connections")
      .update({ default_id_empreendimento: empreendimentoId })
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true);
    if (error) throw new Error(error.message);
    return jsonResponse({ ok: true });
  });
});
