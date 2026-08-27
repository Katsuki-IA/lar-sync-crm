import { handleOptions, jsonResponse, withErrorHandling } from "../_shared/meta.ts";
import {
  assertWhatsAppConnectionAllowed,
  createOnboardingSession,
  getAuthorizedWhatsAppTarget,
  getWhatsAppConfig,
} from "../_shared/whatsapp-embedded.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  return withErrorHandling(async () => {
    const body = (await req.json()) as { empresaId?: unknown };
    const { userId, idEmpresa } = await getAuthorizedWhatsAppTarget(req, body.empresaId);
    await assertWhatsAppConnectionAllowed(idEmpresa);
    const config = getWhatsAppConfig(true);
    const sessionId = await createOnboardingSession({
      idEmpresa,
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
