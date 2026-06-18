import {
  buildMetaOAuthUrl,
  createSignedState,
  getAuthorizedCrmUser,
  getMetaConfig,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { appId, appSecret, redirectUri, graphVersion } = getMetaConfig();
    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const state = await createSignedState(userId, crmUser.id_empresa, appSecret);

    return jsonResponse({
      url: buildMetaOAuthUrl({
        appId,
        redirectUri,
        graphVersion,
        state,
      }),
    });
  });
});
