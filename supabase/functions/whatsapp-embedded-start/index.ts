import {
  getAuthorizedCrmUser,
  handleOptions,
  jsonResponse,
  withErrorHandling,
} from "../_shared/meta.ts";
import { createOnboardingSession, getWhatsAppConfig } from "../_shared/whatsapp-embedded.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const { userId, crmUser } = await getAuthorizedCrmUser(req);
    const config = getWhatsAppConfig(true);
    const sessionId = await createOnboardingSession({
      idEmpresa: crmUser.id_empresa,
      userId,
    });

    return jsonResponse({
      appId: config.appId,
      configId: config.configId,
      graphVersion: config.graphVersion,
      sessionId,
    });
  });
});
