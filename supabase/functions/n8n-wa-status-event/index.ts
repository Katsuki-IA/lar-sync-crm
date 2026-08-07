import {
  authorizeN8n,
  createSupabaseAdmin,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  optionalString,
  readJsonObject,
  requiredString,
} from "../_shared/n8n-internal.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed();
  const unauthorized = authorizeN8n(req, "N8N_WHATS_SECRET");
  if (unauthorized) return unauthorized;

  try {
    const payload = await readJsonObject(req);
    const status = requiredString(payload.p_status, "p_status", 50).toLowerCase();
    if (!new Set(["sent", "delivered", "read", "failed", "deleted"]).has(status)) {
      throw new Error("p_status inválido");
    }

    const timestampMeta = requiredString(payload.p_timestamp_meta, "p_timestamp_meta", 50);
    if (Number.isNaN(Date.parse(timestampMeta))) throw new Error("p_timestamp_meta inválido");

    const admin = createSupabaseAdmin();
    const { data, error } = await admin.rpc("insert_wa_status_event", {
      p_phone_number_id: requiredString(payload.p_phone_number_id, "p_phone_number_id", 100),
      p_message_id: requiredString(payload.p_message_id, "p_message_id", 255),
      p_recipient_id: requiredString(payload.p_recipient_id, "p_recipient_id", 255),
      p_status: status,
      p_timestamp_meta: new Date(timestampMeta).toISOString(),
      p_error_code: optionalString(payload.p_error_code, 100),
      p_error_message: optionalString(payload.p_error_message, 2_000),
      p_dedupe_key: requiredString(payload.p_dedupe_key, "p_dedupe_key", 500),
      p_raw: payload.p_raw ?? {},
    });
    if (error) throw new Error(error.message);

    return jsonResponse({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
});
