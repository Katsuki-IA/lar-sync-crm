import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function setup(options: { denied?: boolean; anonymous?: boolean; tenant?: number; cached?: boolean; badHost?: boolean } = {}) {
  const storage = {
    info: vi.fn(async () => ({ data: options.cached ? {} : null })),
    upload: vi.fn(async () => ({})),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/audio" } })),
  };
  const rows: Record<string, unknown> = {
    lead: { id_empresa: 35 }, n8n_chat_conversas: { id_empresa: 35, wa_message_id: "uuid" },
    wa_messages: { id: "uuid", tenant_id: options.tenant ?? 35, direction: "inbound", phone_number_id: "123",
      raw: { message: { audio: { id: "123456", mime_type: "audio/ogg; codecs=opus" } } } },
    credentials: { whatsapp_access_token: "secret" },
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: "user" } } }) },
    rpc: vi.fn(async () => ({ data: options.denied ? [] : [{ id: 20 }] })),
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, single: async () => ({ data: rows[table] }) };
      return q;
    }, storage: { from: () => storage },
  };
  const fetchMock = vi.fn(async (url: string | URL) => String(url).includes("graph.facebook")
    ? Response.json({ url: options.badHost ? "https://evil.example/audio" : "https://lookaside.fbsbx.com/audio", file_size: 8 })
    : new Response(new TextEncoder().encode("OggStest")));
  let handler!: (r: Request) => Promise<Response>;
  const source = readFileSync(new URL("../../supabase/functions/conversation-audio/index.ts", import.meta.url), "utf8").replace(/^import .*;$/m, "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function("createClient", "Deno", "fetch", compiled)(() => client,
    { env: { get: () => "test" }, serve: (h: typeof handler) => handler = h }, fetchMock);
  const request = (chatId: string | number = 20) => handler(new Request("https://example.com", { method: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ leadId: 10, chatId }) }));
  return { request, storage, fetchMock, client };
}

describe("áudio privado do Hub", () => {
  it("aceita o identificador prefixado enviado pela tela real", async () => {
    const t = setup(); expect((await t.request("chat-20")).status).toBe(200);
    expect(t.client.rpc).toHaveBeenCalledWith("crm_whatsapp_conversation_messages_v2", { p_lead_id: 10, p_before_id: 21, p_limit: 1 });
  });
  it.each(["chat-20x", "other-20", "chat--20", "chat-0"])("recusa identificador malformado %s", async id => {
    const t = setup(); expect((await t.request(id)).status).toBe(400);
    expect(t.client.rpc).not.toHaveBeenCalled();
  });
  it("baixa o áudio autenticado, armazena e entrega URL temporária", async () => {
    const t = setup(); const r = await t.request();
    expect(r.status).toBe(200);
    expect(t.client.rpc).toHaveBeenCalledWith("crm_whatsapp_conversation_messages_v2", { p_lead_id: 10, p_before_id: 21, p_limit: 1 });
    expect(t.storage.upload).toHaveBeenCalledWith("35/uuid.ogg", expect.any(Uint8Array), { contentType: "audio/ogg", upsert: true });
    expect(JSON.stringify(await r.json())).not.toContain("secret");
  });
  it.each([{ anonymous: true }, { denied: true }, { tenant: 36 }])("recusa acesso indevido %j", async options => {
    const t = setup(options); expect((await t.request()).status).toBeGreaterThanOrEqual(400);
    expect(t.fetchMock).not.toHaveBeenCalled(); expect(t.storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("reutiliza cópia privada sem depender da URL temporária da Meta", async () => {
    const t = setup({ cached: true }); expect((await t.request()).status).toBe(200);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });
  it("não encaminha o token para outro host", async () => {
    const t = setup({ badHost: true }); expect((await t.request()).status).toBe(502);
    expect(t.fetchMock).toHaveBeenCalledTimes(1); expect(t.storage.upload).not.toHaveBeenCalled();
  });
});
