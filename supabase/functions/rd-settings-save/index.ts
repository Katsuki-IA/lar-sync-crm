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
    const { empreendimentoId, funnelId } = (await req.json()) as {
      empreendimentoId?: number;
      funnelId?: number;
    };
    if (!empreendimentoId || !Number.isInteger(empreendimentoId)) {
      throw new Error("Selecione o empreendimento padrão");
    }
    if (!funnelId || !Number.isInteger(funnelId)) {
      throw new Error("Selecione o funil padrão");
    }
    const { crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const [empreendimentoResult, funnelResult] = await Promise.all([
      supabaseAdmin
        .from("empreendimento")
        .select("id")
        .eq("id", empreendimentoId)
        .eq("id_empresa", crmUser.id_empresa)
        .maybeSingle(),
      supabaseAdmin
        .from("crm_funnels")
        .select("id")
        .eq("id", funnelId)
        .eq("id_empresa", crmUser.id_empresa)
        .eq("ativo", true)
        .maybeSingle(),
    ]);
    if (empreendimentoResult.error) throw new Error(empreendimentoResult.error.message);
    if (funnelResult.error) throw new Error(funnelResult.error.message);
    if (!empreendimentoResult.data) throw new Error("Empreendimento não pertence à empresa atual");
    if (!funnelResult.data) throw new Error("Funil não pertence à empresa atual");

    const { error } = await supabaseAdmin
      .from("crm_rd_connections")
      .update({ default_id_empreendimento: empreendimentoId, default_id_funnel: funnelId })
      .eq("id_empresa", crmUser.id_empresa)
      .eq("active", true);
    if (error) throw new Error(error.message);
    return jsonResponse({ ok: true });
  });
});
