import {
  authorizeN8n,
  createSupabaseAdmin,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  positiveInteger,
  readJsonObject,
} from "../_shared/n8n-internal.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed();
  const unauthorized = authorizeN8n(req, "N8N_AGENT_SECRET");
  if (unauthorized) return unauthorized;

  try {
    const payload = await readJsonObject(req);
    const idEmpresa = positiveInteger(payload.p_id_empresa ?? payload.id_empresa, "id_empresa");
    const admin = createSupabaseAdmin();
    const { data, error } = await admin.rpc("get_empreendimento", {
      p_id_empresa: idEmpresa,
    });
    if (error) throw new Error(error.message);

    return jsonResponse(data ?? []);
  } catch (error) {
    return errorResponse(error);
  }
});
