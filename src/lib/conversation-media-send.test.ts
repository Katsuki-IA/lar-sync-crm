import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as media from "../../supabase/functions/_shared/conversation-media";
import * as templates from "../../supabase/functions/_shared/conversation-templates";

const uuid = "c9f240fc-f6d1-4a7c-9279-737a9bc54b49";
function setup(
  options: {
    open?: boolean;
    assigned?: string;
    company?: number;
    mime?: string;
    size?: number;
    signature?: number[];
    metaFails?: boolean;
    alreadySent?: boolean;
    closeDuringUpload?: boolean;
  } = {},
) {
  const filename =
    options.mime === "image/png"
      ? "file.png"
      : options.mime === "image/jpeg"
        ? "file.jpg"
        : "file.pdf";
  const kind = options.mime?.startsWith("image/") ? "image" : "document";
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
    credentials: { whatsapp_business_id: "phone", whatsapp_access_token: "fake-token" },
    crm_whatsapp_connections: null,
    wa_messages: options.alreadySent
      ? { message_id: "wamid.previous", status_current: "accepted" }
      : null,
  };
  const storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { path, token: "upload-token" },
    })),
    list: vi.fn(async () => ({
      data: [
        {
          name: filename,
          metadata: { size: options.size ?? 100, mimetype: options.mime ?? "application/pdf" },
        },
      ],
    })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/file" } })),
  };
  let windowChecks = 0;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: "auth" } } }) },
    storage: { from: () => storage },
    rpc: vi.fn(async () => ({
      data: [
        { window_open: options.closeDuringUpload ? ++windowChecks === 1 : (options.open ?? true) },
      ],
    })),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const key of ["select", "eq", "not", "limit", "order"]) q[key] = () => q;
      q.maybeSingle = async () => ({ data: rows[table] });
      q.single = async () => ({ data: { id: "transport-id" } });
      q.upsert = (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return q;
      };
      q.insert = async (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return {};
      };
      q.update = (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return q;
      };
      return q;
    },
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith("https://storage.example"))
      return new Response(
        new Uint8Array(
          options.signature ??
            (options.mime === "image/png"
              ? [137, 80, 78, 71, 13, 10, 26, 10]
              : options.mime === "image/jpeg"
                ? [255, 216, 255]
                : [37, 80, 68, 70, 45, 49, 46, 55]),
        ),
      );
    if (options.metaFails)
      return Response.json({ error: { code: 131047, message: "Window closed" } }, { status: 400 });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      type: kind,
      [kind]: {
        ...(kind === "document" ? { filename } : {}),
        caption: "Planta do imóvel",
        link: "https://storage.example/file",
      },
    });
    return Response.json({ messages: [{ id: "wamid.pdf", message_status: "accepted" }] });
  });
  let handler!: (req: Request) => Promise<Response>;
  const source = readFileSync(
    new URL("../../supabase/functions/whatsapp-conversation-send/index.ts", import.meta.url),
    "utf8",
  ).replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const injected = {
    createClient: () => admin,
    Deno: { env: { get: () => "test" }, serve: (h: typeof handler) => (handler = h) },
    fetch: fetchMock,
    ...media,
    ...templates,
    console: { error: () => {} },
  };
  new Function(...Object.keys(injected), compiled)(...Object.values(injected));
  const path = media.mediaPath(1, 10, "agent", uuid, filename);
  const request = (body: Record<string, unknown> = {}) =>
    handler(
      new Request("https://example.com", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: JSON.stringify({
          leadId: 10,
          clientMessageId: uuid,
          action: "send_media",
          fileName: filename,
          mimeType: options.mime ?? "application/pdf",
          fileSize: 100,
          storagePath: path,
          caption: "Planta do imóvel",
          ...body,
        }),
      }),
    );
  return { request, fetchMock, writes, storage };
}
describe("anexos do atendimento humano", () => {
  it("prepara upload privado sem enviar mensagem", async () => {
    const t = setup();
    const r = await t.request({ action: "prepare_media" });
    expect(r.status).toBe(200);
    expect((await r.json()).path).toContain("1/10/agent/");
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.writes).toEqual([]);
  });
  it("envia PDF e registra mídia com legenda e origem humana", async () => {
    const t = setup();
    expect((await t.request()).status).toBe(200);
    expect(t.writes.find((w) => w.table === "wa_messages")?.value).toMatchObject({
      type: "document",
      raw: { source: "hub_human" },
    });
    expect(t.writes.find((w) => w.table === "n8n_chat_conversas")?.value.message).toMatchObject({
      attachment: { kind: "document", filename: "file.pdf", caption: "Planta do imóvel" },
    });
  });
  it.each(["image/jpeg", "image/png"])("envia imagem %s pelo campo image da Meta", async (mime) => {
    const t = setup({ mime });
    expect((await t.request()).status).toBe(200);
    expect(t.writes.find((w) => w.table === "wa_messages")?.value).toMatchObject({ type: "image" });
  });
  it("bloqueia se a janela fechar durante o carregamento", async () => {
    const t = setup({ closeDuringUpload: true });
    expect((await t.request()).status).toBe(400);
    expect(
      t.fetchMock.mock.calls.filter((c) => String(c[0]).includes("graph.facebook")),
    ).toHaveLength(0);
    expect(t.writes).toEqual([]);
  });
  it.each([{ open: false }, { assigned: "other" }, { company: 2 }])(
    "recusa janela fechada e atendimento de outra pessoa/empresa %j",
    async (options) => {
      const t = setup(options);
      expect((await t.request()).status).toBe(400);
      expect(t.fetchMock).not.toHaveBeenCalled();
      expect(t.writes).toEqual([]);
    },
  );
  it("recusa caminho de outro atendente", async () => {
    const t = setup();
    expect((await t.request({ storagePath: "1/10/other/file.pdf" })).status).toBe(400);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });
  it("recusa tamanho declarado divergente e conteúdo falso", async () => {
    for (const options of [{ size: 101 }, { signature: [0, 1, 2, 3, 4] }]) {
      const t = setup(options);
      expect((await t.request()).status).toBe(400);
      expect(
        t.fetchMock.mock.calls.filter((c) => String(c[0]).includes("graph.facebook")),
      ).toHaveLength(0);
      expect(t.writes).toEqual([]);
    }
  });
  it("mantém erro da Meta sem registrar sucesso", async () => {
    const t = setup({ metaFails: true });
    expect((await t.request()).status).toBe(400);
    expect(t.writes).toEqual([]);
  });
  it("retry do mesmo envio confirmado não duplica mensagem", async () => {
    const t = setup({ alreadySent: true });
    expect((await t.request()).status).toBe(200);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.writes).toEqual([]);
  });
  it("valida limites e formatos de imagem e PDF", () => {
    expect(media.validateMediaFile("foto.jpg", "image/jpeg", 5 * 1024 * 1024)).toBe("image");
    expect(media.validateMediaFile("foto.png", "image/png", 500)).toBe("image");
    expect(media.validateMediaFile("planta.pdf", "application/pdf", 100 * 1024 * 1024)).toBe(
      "document",
    );
    expect(() => media.validateMediaFile("foto.jpg", "image/jpeg", 5 * 1024 * 1024 + 1)).toThrow(
      "5 MB",
    );
    expect(() =>
      media.validateMediaFile("planta.pdf", "application/pdf", 100 * 1024 * 1024 + 1),
    ).toThrow("100 MB");
    expect(() => media.validateMediaFile("foto.gif", "image/gif", 500)).toThrow("JPG/PNG");
    expect(() => media.validateMediaFile("planta.pdf", "application/pdf", 0)).toThrow("vazio");
    media.validateMediaSignature(new Uint8Array([255, 216, 255]), "image/jpeg");
    media.validateMediaSignature(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png");
  });
});
