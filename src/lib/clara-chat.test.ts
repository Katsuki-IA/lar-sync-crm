import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt, parseContact } from "./clara-chat";

describe("montagem do prompt", () => {
  it("usa 55 e 56 do banco na ordem e o conhecimento por ordem", () => {
    const s = buildSystemPrompt([55, 56],
      [{ id: 56, node: "Agendamento", prompt: "B" }, { id: 55, node: "Atendimento", prompt: "A" }],
      [{ titulo: "Z", categoria: null, conteudo: "kb2", ordem: 2 }, { titulo: "Y", categoria: null, conteudo: "kb1", ordem: 1 }]);
    expect(s.indexOf("A")).toBeLessThan(s.indexOf("# Agendamento"));
    expect(s.indexOf("kb1")).toBeLessThan(s.indexOf("kb2"));
  });
  it("falha se um prompt configurado não existir (sem fallback fixo)", () => {
    expect(() => buildSystemPrompt([55, 56], [{ id: 55, node: "x", prompt: "A" }], [])).toThrow("prompt_missing:56");
  });
});

describe("contato informado", () => {
  it("exige nome e e-mail ou telefone real", () => {
    expect(parseContact({ nome: "Ana", email: null, telefone: null })).toBeNull();
    expect(parseContact({ nome: "Ana", email: "a@b.com", telefone: null })).toEqual({ nome: "Ana", email: "a@b.com", telefone: null });
    expect(parseContact({ nome: "Ana", email: null, telefone: "123" })).toBeNull();
  });
});

const SQL = readFileSync(join(__dirname, "..", "..", "docs", "clara-chat-candidato.sql"), "utf8");
const core = SQL.slice(SQL.indexOf("-- === pglite-core-begin ==="), SQL.indexOf("-- === pglite-core-end ==="));
const H = (c: string) => c.repeat(64);
const R1 = "00000000-0000-0000-0000-000000000001";
const R2 = "00000000-0000-0000-0000-000000000002";

describe("SQL candidato (PGlite)", () => {
  let db: PGlite;
  const call = async (fn: string, args: unknown[]) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(",");
    return ((await db.query(`select public.${fn}(${ph}) r`, args)).rows[0] as any).r;
  };
  const open = () => call("web_chat_open", [38, H("a"), H("f")]);
  const begin = (r: string, kind: string, text: string | null) => call("web_chat_begin", [38, H("a"), H("f"), r, kind, text]);
  const finish = (r: string, reply: string) => call("web_chat_finish", [38, H("a"), r, reply, null]);

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.empresa_dados (id bigint primary key); insert into public.empresa_dados values (38);`);
    await db.exec(core);
    await db.exec(`insert into private.web_chat_config (empresa_id, enabled) values (38, true)`);
  });

  it("abertura acontece uma vez, mesmo com outro requestId", async () => {
    expect((await open()).greeted).toBe(false);
    expect((await begin(R1, "greeting", null)).status).toBe("proceed");
    expect((await finish(R1, "Oi, sou a Clara")).status).toBe("done");
    expect((await begin(R2, "greeting", null)).status).toBe("done");
    const o = await open();
    expect(o.greeted).toBe(true);
    expect(o.messages).toHaveLength(1);
  });

  it("retry do mesmo requestId devolve a resposta salva sem duplicar", async () => {
    await open();
    await begin(R1, "message", "Olá");
    await finish(R1, "Resposta");
    const again = await begin(R1, "message", "Olá");
    expect(again.status).toBe("done");
    expect(again.reply.content).toBe("Resposta");
    expect((await open()).messages).toHaveLength(2);
  });

  it("lease bloqueia geração simultânea e só o detentor grava", async () => {
    await open();
    expect((await begin(R1, "message", "a")).status).toBe("proceed");
    expect((await begin(R2, "message", "b")).status).toBe("busy");
    expect((await finish(R2, "x")).status).toBe("invalid");
  });

  it("falha libera o lease e permite retry sem duplicar a mensagem do usuário", async () => {
    await open();
    await begin(R1, "message", "a");
    expect((await finish(R1, "")).status).toBe("failed");
    expect((await begin(R1, "message", "a")).status).toBe("proceed");
    await finish(R1, "ok");
    expect((await open()).messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  it("limita 20 mensagens por 10 minutos na sessão", async () => {
    await open();
    for (let i = 0; i < 20; i++) {
      const r = `00000000-0000-0000-0000-${String(100 + i).padStart(12, "0")}`;
      await begin(r, "message", "m"); await finish(r, "ok");
    }
    expect((await begin(R2, "message", "m")).status).toBe("rate_limited");
  });

  it("sessão desconhecida e config desativada não geram", async () => {
    expect((await call("web_chat_begin", [38, H("b"), H("f"), R1, "message", "x"])).status).toBe("no_session");
    await db.exec(`update private.web_chat_config set enabled = false`);
    expect((await open()).status).toBe("disabled");
  });

  it("anon/authenticated não executam e não leem tabelas", async () => {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(`select has_function_privilege($1, 'public.web_chat_begin(bigint,text,text,uuid,text,text)', 'execute') a,
        has_table_privilege($1, 'private.web_chat_messages', 'select') b`, [role]);
      expect(rows[0]).toEqual({ a: false, b: false });
    }
    const { rows } = await db.query(`select has_function_privilege('service_role', 'public.web_chat_begin(bigint,text,text,uuid,text,text)', 'execute') a`);
    expect(rows[0]).toEqual({ a: true });
  });
});

describe("transporte da Clara", () => {
  it("sem OPENAI_API_KEY e sem ponte, fica indisponível (sem outro provedor)", async () => {
    const prev = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    const { resolveCompletionTransport } = await import("./clara-chat.server");
    expect(resolveCompletionTransport()).toBeNull();
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });
  it("executa a ferramenta de contato e devolve o texto final via transporte injetado", async () => {
    const { generateClaraReply } = await import("./clara-chat.server");
    const calls: any[] = [];
    const replies = [
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "registrar_contato", arguments: JSON.stringify({ nome: "Ana", email: "ana@x.com", telefone: null }) } }] } }] },
      { choices: [{ message: { role: "assistant", content: "Obrigada, Ana!" } }] },
    ];
    const out = await generateClaraReply({ system: "S", history: [{ role: "user", content: "oi" }], greeting: false,
      model: "gpt-4.1", temperature: 0.5, transport: async (b) => { calls.push(b); return replies[calls.length - 1]; } });
    expect(out).toEqual({ text: "Obrigada, Ana!", contact: { nome: "Ana", email: "ana@x.com", telefone: null } });
    expect(calls[0]).toMatchObject({ model: "gpt-4.1", temperature: 0.5 });
  });
});
