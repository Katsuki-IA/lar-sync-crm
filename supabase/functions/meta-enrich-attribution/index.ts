import {
  createSupabaseAdmin,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  checkMetaTokenPermissions,
  enrichMetaAttributionForCompany,
} from "../_shared/meta-attribution.ts";

type EnrichRequest = {
  leadId?: number;
  limit?: number;
  dryRun?: boolean;
};

async function handlePost(req: Request) {
  const options = handleOptions(req);
  if (options) return options;

  const { crmUser } = await getAuthorizedCrmUser(req);
  const body = (await req.json().catch(() => ({}))) as EnrichRequest;
  const supabaseAdmin = createSupabaseAdmin();
  const { appId, appSecret, graphVersion } = getMetaConfig();

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from("crm_meta_connections")
    .select("id,user_access_token,active,connected_at")
    .eq("id_empresa", crmUser.id_empresa)
    .eq("active", true)
    .maybeSingle();

  if (connectionError) throw new Error(connectionError.message);
  if (!connection?.user_access_token) {
    return jsonResponse(
      {
        connected: false,
        hasAdsRead: false,
        message: "Nenhuma conexão Meta ativa encontrada para esta empresa.",
      },
      404,
    );
  }

  const permission = await checkMetaTokenPermissions({
    appId,
    appSecret,
    graphVersion,
    userAccessToken: connection.user_access_token,
  });

  if (!permission.hasAdsRead) {
    return jsonResponse(
      {
        connected: true,
        hasAdsRead: false,
        scopes: permission.scopes,
        permissionError: permission.error,
        message:
          "A conexão Meta atual não possui ads_read. Adicione a permissão no app Meta e reconecte a conta/páginas.",
      },
      409,
    );
  }

  if (body.dryRun) {
    return jsonResponse({
      connected: true,
      hasAdsRead: true,
      scopes: permission.scopes,
      dryRun: true,
    });
  }

  const enrichment = await enrichMetaAttributionForCompany({
    supabaseAdmin,
    idEmpresa: crmUser.id_empresa,
    accessToken: connection.user_access_token,
    graphVersion,
    leadId: body.leadId ?? null,
    limit: body.limit ?? 30,
  });

  return jsonResponse({
    connected: true,
    hasAdsRead: true,
    scopes: permission.scopes,
    ...enrichment,
  });
}

Deno.serve((req) =>
  withErrorHandling(async () => {
    const options = handleOptions(req);
    if (options) return options;
    if (req.method !== "POST") {
      return jsonResponse({ error: "Método não permitido" }, 405);
    }
    return handlePost(req);
  }),
);
