import {
  authorizeN8n,
  createSupabaseAdmin,
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonObject,
  requiredString,
} from "../_shared/n8n-internal.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed();
  const unauthorized = authorizeN8n(req, "N8N_WHATS_SECRET");
  if (unauthorized) return unauthorized;

  try {
    const payload = await readJsonObject(req);
    const timestampMeta = requiredString(payload.timestamp_meta, "timestamp_meta", 50);
    if (Number.isNaN(Date.parse(timestampMeta))) throw new Error("timestamp_meta inválido");

    const direction = requiredString(payload.direction ?? "inbound", "direction", 20).toLowerCase();
    if (!new Set(["inbound", "outbound"]).has(direction)) {
      throw new Error("direction inválido");
    }

    const row = {
      phone_number_id: requiredString(payload.phone_number_id, "phone_number_id", 100),
      message_id: requiredString(payload.message_id, "message_id", 255),
      direction,
      from_wa_id: requiredString(payload.from_wa_id, "from_wa_id", 255),
      raw: payload.raw ?? {},
      timestamp_meta: new Date(timestampMeta).toISOString(),
    };

    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("wa_messages")
      .upsert(row, { onConflict: "phone_number_id,message_id" })
      .select();
    if (error) throw new Error(error.message);

    return jsonResponse(data ?? []);
  } catch (error) {
    return errorResponse(error);
  }
});
