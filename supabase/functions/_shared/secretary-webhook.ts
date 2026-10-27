// Provider event shapes are validated below before invoking the token-scoped bridge.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function incomingMessage(payload: Record<string, any>, instance: string) {
  if (
    payload?.instance !== instance ||
    String(payload?.event).toLowerCase().replace(/[._-]/g, "") !== "messagesupsert"
  )
    return null;
  const data = payload.data,
    key = data?.key;
  // Evolution can identify a personal chat by LID and supply its phone JID
  // separately. Never interpret the LID itself as a phone or fall back for groups.
  const phoneJid =
    typeof key?.remoteJid === "string" && /^[1-9][0-9]{0,19}@lid$/.test(key.remoteJid)
      ? key.remoteJidAlt
      : key?.remoteJid;
  if (
    key?.fromMe !== false ||
    typeof phoneJid !== "string" ||
    !/^[1-9][0-9]{9,14}@s\.whatsapp\.net$/.test(phoneJid) ||
    typeof key.id !== "string" ||
    key.id.length < 1 ||
    key.id.length > 200
  )
    return null;
  const body = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
  if (typeof body !== "string" || !body.trim() || body.length > 500) return null;
  return {
    p_instance: instance,
    p_phone: phoneJid.split("@")[0],
    p_event_id: key.id,
    p_body: body,
  };
}

export function incomingUazapi(payload: Record<string, any>, instance: string) {
  if (payload?.EventType !== "messages" || payload?.instanceName !== instance) return null;
  const m = payload.message;
  if (!m || m.fromMe !== false || m.isGroup !== false || m.wasSentByApi === true) return null;
  const personal = /^[1-9][0-9]{9,14}@s\.whatsapp\.net$/;
  const jid = personal.test(m.sender) ? m.sender : m.sender_pn;
  // Never recover a personal sender from a group/broadcast event.
  if (
    typeof m.chatid !== "string" ||
    !/^[1-9][0-9]{0,19}@(s\.whatsapp\.net|lid)$/.test(m.chatid) ||
    typeof jid !== "string" ||
    !personal.test(jid) ||
    (personal.test(m.chatid) && m.chatid !== jid)
  )
    return null;
  const id = m.messageid ?? m.messageId;
  if (
    typeof id !== "string" ||
    !id ||
    id.length > 200 ||
    typeof m.text !== "string" ||
    !m.text.trim() ||
    m.text.length > 500
  )
    return null;
  return { p_instance: instance, p_phone: jid.split("@")[0], p_event_id: id, p_body: m.text };
}

type Config = { provider: string; instance: string };
type Dependencies = {
  load: (token: string) => Promise<Config | null>;
  receive: (token: string, args: Record<string, unknown>) => Promise<unknown>;
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
export function createSecretaryWebhook({ load, receive }: Dependencies) {
  return async (req: Request) => {
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
    const queryToken = new URL(req.url).searchParams.get("token");
    const token = req.headers.get("x-hub-secret") ?? queryToken;
    if (!token || token.length < 32 || token.length > 512)
      return reply(401, { error: "unauthorized" });
    try {
      const config = await load(token);
      if (!config || (queryToken && config.provider !== "uazapi"))
        return reply(401, { error: "unauthorized" });
      if (Number(req.headers.get("content-length") ?? 0) > 32768)
        return reply(413, { error: "payload_too_large" });
      const reader = req.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32768) {
            await reader.cancel();
            return reply(413, { error: "payload_too_large" });
          }
          chunks.push(value);
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let data: Record<string, any>;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, { error: "invalid_json" });
      }
      if (!data || typeof data !== "object") return reply(400, { error: "invalid_payload" });
      const message =
        config.provider === "uazapi"
          ? incomingUazapi(data, config.instance)
          : config.provider === "evolution"
            ? incomingMessage(data, config.instance)
            : null;
      if (!message) return reply(200, { status: "ignored" });
      return reply(200, await receive(token, message));
    } catch {
      return reply(503, { error: "webhook_unavailable" });
    }
  };
}
