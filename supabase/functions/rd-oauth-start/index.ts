import {
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
  createSupabaseAdmin,
} from "../_shared/meta.ts";
import {
  buildRdOAuthUrl,
  createRdSignedState,
  getRdConfig,
} from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { empreendimentoId } = (await req.json()) as { empreendimentoId?: number };
    if (!empreendimentoId || !Number.isInteger(empreendimentoId)) {
      throw new Error("Selecione o empreendimento padrão");
    }

    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const supabaseAdmin = createSupabaseAdmin();
    const { data: empreendimento, error } = await supabaseAdmin
      .from("empreendimento")
      .select("id")
      .eq("id", empreendimentoId)
      .eq("id_empresa", crmUser.id_empresa)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!empreendimento) throw new Error("Empreendimento não pertence à empresa atual");

    const { clientId, clientSecret, redirectUri } = getRdConfig();
    const state = await createRdSignedState({
      userId,
      idEmpresa: crmUser.id_empresa,
      empreendimentoId,
      secret: clientSecret,
    });
    return jsonResponse({
      url: buildRdOAuthUrl({ clientId, redirectUri, state }),
    });
  });
});
