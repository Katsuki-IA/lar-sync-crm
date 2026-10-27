import { it, expect, vi } from "vitest";
import {
  createSecretaryWebhook,
  incomingMessage,
  incomingUazapi,
} from "../../supabase/functions/_shared/secretary-webhook";
const token = "fake-webhook-token-".repeat(3);
const payload = {
  instance: "test",
  event: "messages.upsert",
  data: {
    key: { fromMe: false, id: "event-1", remoteJid: "5511999999999@s.whatsapp.net" },
    message: { conversation: "ACEITAR TESTCODE" },
  },
};
it("resolves only personal inbound sender identity and keeps offer codes unchanged", () => {
  expect(incomingMessage(payload, "test")).toEqual({
    p_instance: "test",
    p_phone: "5511999999999",
    p_event_id: "event-1",
    p_body: "ACEITAR TESTCODE",
  });
  expect(incomingMessage({ ...payload, instance: "other" }, "test")).toBeNull();
  expect(
    incomingMessage(
      {
        ...payload,
        data: { ...payload.data, key: { ...payload.data.key, remoteJid: "123@g.us" } },
      },
      "test",
    ),
  ).toBeNull();
  expect(
    incomingMessage(
      { ...payload, data: { ...payload.data, key: { ...payload.data.key, fromMe: true } } },
      "test",
    ),
  ).toBeNull();
});
it("blocks Uazapi groups and API echoes", () => {
  const p = {
    EventType: "messages",
    instanceName: "test",
    message: {
      fromMe: false,
      isGroup: false,
      wasSentByApi: false,
      sender: "5511999999999@s.whatsapp.net",
      chatid: "5511999999999@s.whatsapp.net",
      messageid: "event-2",
      text: "RECUSAR TESTCODE",
    },
  };
  expect(incomingUazapi(p, "test")?.p_phone).toBe("5511999999999");
  expect(incomingUazapi({ ...p, message: { ...p.message, isGroup: true } }, "test")).toBeNull();
  expect(
    incomingUazapi({ ...p, message: { ...p.message, wasSentByApi: true } }, "test"),
  ).toBeNull();
});
it("authenticates before accepting provider events and returns bridge response", async () => {
  const receive = vi.fn(async () => ({ status: "accepted" }));
  const handler = createSecretaryWebhook({
    load: async (t) => (t === token ? { provider: "evolution", instance: "test" } : null),
    receive,
  });
  expect(
    (
      await handler(
        new Request("https://example.invalid", { method: "POST", body: JSON.stringify(payload) }),
      )
    ).status,
  ).toBe(401);
  const res = await handler(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { "x-hub-secret": token },
      body: JSON.stringify(payload),
    }),
  );
  expect(await res.json()).toEqual({ status: "accepted" });
  expect(receive).toHaveBeenCalledTimes(1);
});
it("rejects oversized streamed bodies without executing a command", async () => {
  const receive = vi.fn();
  const handler = createSecretaryWebhook({
    load: async () => ({ provider: "uazapi", instance: "test" }),
    receive,
  });
  const res = await handler(
    new Request("https://example.invalid?token=" + token, {
      method: "POST",
      body: "x".repeat(32769),
    }),
  );
  expect(res.status).toBe(413);
  expect(receive).not.toHaveBeenCalled();
});
