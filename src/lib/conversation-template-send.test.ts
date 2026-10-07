import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as helpers from "../../supabase/functions/_shared/conversation-templates";

// Run the actual Edge handler with isolated transport and database adapters.
function setup(options: { company?: number; assigned?: string; open?: boolean } = {}) {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const lead = {
    id: 10,
    id_empresa: options.company ?? 1,
    numero: "5511999999999",
    atendimento_humano: true,
    wa_conversation_assigned_to: options.assigned ?? "agent",
    wa_identity_id: null,
  };
  const rows: Record<string, unknown> = {
    crm_users: { id: "agent", id_empresa: 1, role: "agent" },
    lead,
    credentials: {
      whatsapp_business_id: "business-phone",
      whatsapp_access_token: "test-token",
      waba_id: "waba",
    },
    crm_whatsapp_connections: null,
    wa_messages: null,
  };
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: "auth-user" } } }) },
    rpc: vi.fn(async () => ({ data: [{ window_open: options.open ?? false }] })),
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "not", "limit", "order"]) query[method] = () => query;
      query.maybeSingle = async () => ({ data: rows[table] });
      query.single = async () => ({ data: { id: "transport-id" } });
      query.upsert = (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return query;
      };
      query.insert = async (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return {};
      };
      query.update = (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return query;
      };
      return query;
    },
  };
  const approved = {
    name: "assumir_conversa_1",
    language: "pt_BR",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Podemos conversar?" }],
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("message_templates"))
      return Response.json({
        data: [
          approved,
          { ...approved, name: "default" },
          { ...approved, name: "assumir_conversa_2", status: "PENDING" },
        ],
      });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      type: "template",
      template: { name: approved.name, language: { code: "pt_BR" } },
    });
    return Response.json({ messages: [{ id: "wamid.test", message_status: "accepted" }] });
  });
  let handler!: (request: Request) => Promise<Response>;
  const source = readFileSync(
    new URL("../../supabase/functions/whatsapp-conversation-send/index.ts", import.meta.url),
    "utf8",
  ).replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  new Function(
    "createClient",
    "Deno",
    "fetch",
    "buildTemplateComponents",
    "isAttendanceTemplate",
    "templatePreview",
    "console",
    compiled,
  )(
    () => admin,
    {
      env: { get: () => "test" },
      serve: (value: typeof handler) => {
        handler = value;
      },
    },
    fetchMock,
    helpers.buildTemplateComponents,
    helpers.isAttendanceTemplate,
    helpers.templatePreview,
    { error: () => {} },
  );
  const request = (body: Record<string, unknown>) =>
    handler(
      new Request("https://example.com", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({ leadId: 10, clientMessageId: "request-id", ...body }),
      }),
    );
  return { request, fetchMock, writes, admin };
}

describe("envio de template na conversa", () => {
  it("lista apenas modelos aprovados para assumir a conversa", async () => {
    const { request, writes, admin } = setup();
    const response = await request({ action: "list_templates" });
    expect(response.status).toBe(200);
    expect((await response.json()).templates.map((t: { name: string }) => t.name)).toEqual([
      "assumir_conversa_1",
    ]);
    expect(writes).toEqual([]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("envia template com janela fechada e registra o histórico sem abrir a janela", async () => {
    const { request, writes, admin } = setup();
    const response = await request({
      action: "send_template",
      templateName: "assumir_conversa_1",
      templateLanguage: "pt_BR",
      templateValues: {},
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, messageId: "wamid.test" });
    expect(writes.find((w) => w.table === "wa_messages")?.value).toMatchObject({
      type: "template",
      tenant_id: 1,
      template_name: "assumir_conversa_1",
    });
    expect(writes.find((w) => w.table === "n8n_chat_conversas")?.value).toMatchObject({
      type: "ai",
      message: "Podemos conversar?",
    });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("mantém o bloqueio de texto livre com janela fechada", async () => {
    const { request, fetchMock } = setup();
    const response = await request({ text: "Olá" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("24 horas está fechada");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("recusa outras empresas, outros atendentes e templates fora do filtro", async () => {
    for (const options of [{ company: 2 }, { assigned: "another-agent" }, {}]) {
      const { request, fetchMock, writes } = setup(options);
      const response = await request({
        action: "send_template",
        templateName: "default",
        templateLanguage: "pt_BR",
      });
      expect(response.status).toBe(400);
      expect(writes).toEqual([]);
      expect(fetchMock.mock.calls.every(([url]) => String(url).includes("message_templates"))).toBe(
        true,
      );
    }
  });
});
