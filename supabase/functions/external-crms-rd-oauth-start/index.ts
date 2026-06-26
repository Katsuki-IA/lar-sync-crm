import {
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  buildRdOAuthUrl,
  createRdDestinationSignedState,
  getRdDestinationConfig,
} from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const { clientId, clientSecret, redirectUri } = getRdDestinationConfig();
    const state = await createRdDestinationSignedState({
      userId,
      idEmpresa: crmUser.id_empresa,
      secret: clientSecret,
    });

    return jsonResponse({
      url: buildRdOAuthUrl({ clientId, redirectUri, state }),
    });
  });
});
