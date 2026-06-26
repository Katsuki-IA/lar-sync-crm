import {
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import {
  buildRdCrmOAuthUrl,
  getRdDestinationConfig,
} from "../_shared/rd.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    await getAuthorizedCrmUser(req);
    const { clientId, redirectUri } = getRdDestinationConfig();

    return jsonResponse({
      url: buildRdCrmOAuthUrl({ clientId, redirectUri }),
    });
  });
});
