import { createSupabaseAdmin, jsonResponse } from "../_shared/meta.ts";

type WebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  [key: string]: unknown;
};

type WebhookStatus = {
  id?: string;
  recipient_id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ code?: number | string; title?: string; message?: string }>;
  pricing?: unknown;
  conversation?: unknown;
  [key: string]: unknown;
};

type WebhookValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
  [key: string]: unknown;
};

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: WebhookValue }>;
  }>;
};

type Mapping = {
  id_empresa: number;
  phone_number_id: string | null;
  display_phone_number: string | null;
  connection_id: string;
};

function constantTimeEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function hmacSha256Hex(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(content: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function metaTimestamp(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function messageText(message: WebhookMessage) {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    null
  );
}

function validStatus(status: unknown): status is "sent" | "delivered" | "read" | "failed" {
  return typeof status === "string" && new Set(["sent", "delivered", "read", "failed"]).has(status);
}

async function resolveMapping(
  admin: ReturnType<typeof createSupabaseAdmin>,
  phoneNumberId: string | null,
  wabaId: string | null,
): Promise<Mapping | null> {
  if (phoneNumberId) {
    const { data: phone, error } = await admin
      .from("crm_whatsapp_phone_numbers")
      .select(
        "id_empresa,phone_number_id,display_phone_number,connection_id,crm_whatsapp_connections!inner(status)",
      )
      .eq("phone_number_id", phoneNumberId)
      .eq("active", true)
      .eq("crm_whatsapp_connections.status", "connected")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (phone) return phone as unknown as Mapping;
  }

  if (wabaId) {
    const { data: connection, error } = await admin
      .from("crm_whatsapp_connections")
      .select("id,id_empresa")
      .eq("waba_id", wabaId)
      .eq("status", "connected")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (connection) {
      return {
        id_empresa: connection.id_empresa,
        connection_id: connection.id,
        phone_number_id: phoneNumberId,
        display_phone_number: null,
      };
    }
  }
  return null;
}

async function storeEvent(
  admin: ReturnType<typeof createSupabaseAdmin>,
  mapping: Mapping,
  input: {
    eventType: string;
    eventKey: string;
    messageId?: string | null;
    payload: unknown;
    occurredAt: string;
  },
) {
  const { error } = await admin.from("crm_whatsapp_review_events").upsert(
    {
      id_empresa: mapping.id_empresa,
      connection_id: mapping.connection_id,
      phone_number_id: mapping.phone_number_id,
      source: "webhook",
      event_type: input.eventType,
      event_key: input.eventKey,
      message_id: input.messageId ?? null,
      payload: input.payload,
      occurred_at: input.occurredAt,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

async function handleMessage(
  admin: ReturnType<typeof createSupabaseAdmin>,
  mapping: Mapping,
  value: WebhookValue,
  message: WebhookMessage,
) {
  if (!mapping.phone_number_id || !message.id || !message.from) return 0;
  const occurredAt = metaTimestamp(message.timestamp);
  const contact =
    value.contacts?.find((item) => item.wa_id === message.from) ?? value.contacts?.[0];
  const row = {
    phone_number_id: mapping.phone_number_id,
    message_id: message.id,
    direction: "inbound",
    from_wa_id: message.from,
    to_wa_id: mapping.display_phone_number?.replace(/\D/gu, "") ?? mapping.phone_number_id,
    contact_name: contact?.profile?.name ?? null,
    type: message.type ?? "unknown",
    text_body: messageText(message),
    timestamp_meta: occurredAt,
    tenant_id: mapping.id_empresa,
    raw: { contacts: value.contacts ?? [], message },
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("wa_messages")
    .upsert(row, { onConflict: "phone_number_id,message_id" });
  if (error) throw new Error(error.message);
  await storeEvent(admin, mapping, {
    eventType: "message_received",
    eventKey: `message:${mapping.phone_number_id}:${message.id}`,
    messageId: message.id,
    payload: row.raw,
    occurredAt,
  });
  return 1;
}

async function handleStatus(
  admin: ReturnType<typeof createSupabaseAdmin>,
  mapping: Mapping,
  status: WebhookStatus,
) {
  if (!mapping.phone_number_id || !status.id || !validStatus(status.status)) return 0;
  const occurredAt = metaTimestamp(status.timestamp);
  const firstError = status.errors?.[0];
  const dedupeKey = `${mapping.phone_number_id}:status:${status.id}:${status.status}:${status.timestamp ?? "na"}`;
  const { error: statusError } = await admin.from("wa_message_status_events").upsert(
    {
      phone_number_id: mapping.phone_number_id,
      message_id: status.id,
      recipient_id: status.recipient_id ?? null,
      status: status.status,
      timestamp_meta: occurredAt,
      pricing: status.pricing ?? {},
      conversation: status.conversation ?? {},
      error_code: firstError?.code ? String(firstError.code) : null,
      error_message: firstError?.message ?? firstError?.title ?? null,
      dedupe_key: dedupeKey,
      raw: status,
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (statusError) throw new Error(statusError.message);

  const statusColumn = {
    sent: "sent_at",
    delivered: "delivered_at",
    read: "read_at",
    failed: "failed_at",
  }[status.status];
  const update: Record<string, unknown> = {
    status_current: status.status,
    status_last_at: occurredAt,
    error_code: firstError?.code ? String(firstError.code) : null,
    error_message: firstError?.message ?? firstError?.title ?? null,
    updated_at: new Date().toISOString(),
    [statusColumn]: occurredAt,
  };
  const { error: messageError } = await admin
    .from("wa_messages")
    .update(update)
    .eq("phone_number_id", mapping.phone_number_id)
    .eq("message_id", status.id);
  if (messageError) throw new Error(messageError.message);
  await storeEvent(admin, mapping, {
    eventType: `message_${status.status}`,
    eventKey: dedupeKey,
    messageId: status.id,
    payload: status,
    occurredAt,
  });
  return 1;
}

async function handleWebhook(raw: string) {
  const payload = JSON.parse(raw) as WebhookPayload;
  if (payload.object !== "whatsapp_business_account") return jsonResponse({ received: true });
  const admin = createSupabaseAdmin();
  let stored = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const mapping = await resolveMapping(admin, phoneNumberId, entry.id ?? null);
      if (!mapping) continue;

      let handled = false;
      for (const message of value.messages ?? []) {
        stored += await handleMessage(admin, mapping, value, message);
        handled = true;
      }
      for (const status of value.statuses ?? []) {
        stored += await handleStatus(admin, mapping, status);
        handled = true;
      }
      if (!handled) {
        const occurredAt = new Date().toISOString();
        const eventPayload = { entryId: entry.id ?? null, field: change.field ?? null, value };
        const eventHash = await sha256Hex(JSON.stringify(eventPayload));
        await storeEvent(admin, mapping, {
          eventType: change.field ?? "account_update",
          eventKey: `change:${mapping.id_empresa}:${eventHash}`,
          payload: eventPayload,
          occurredAt,
        });
        stored += 1;
      }
    }
  }
  return jsonResponse({ received: true, stored });
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const configured = (
      Deno.env.get("META_WHATSAPP_WEBHOOK_VERIFY_TOKEN") ??
      Deno.env.get("N8N_WHATS_SECRET") ??
      ""
    ).trim();
    if (mode === "subscribe" && configured && constantTimeEquals(token, configured)) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) return jsonResponse({ error: "Payload excede o limite" }, 413);
    const appSecret = Deno.env.get("META_WHATSAPP_APP_SECRET")?.trim() ?? "";
    if (!appSecret) return jsonResponse({ error: "Webhook não configurado" }, 503);
    const signature = req.headers.get("x-hub-signature-256")?.trim() ?? "";
    const expected = `sha256=${await hmacSha256Hex(appSecret, raw)}`;
    if (!signature || !constantTimeEquals(signature, expected)) {
      return jsonResponse({ error: "Assinatura inválida" }, 401);
    }
    return await handleWebhook(raw);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Erro ao processar webhook" }, 500);
  }
});
