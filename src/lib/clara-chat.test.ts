import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt, canSeeWebChat, contactFromUserMessages, isAllowedOrigin, parseContact, WEB_CHANNEL_NOTE } from "./clara-chat";

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
  it("nota de canal não promete contato da equipe nem Meet", () => {
    expect(WEB_CHANNEL_NOTE).not.toMatch(/equipe .*entrar/i);
    expect(WEB_CHANNEL_NOTE).toMatch(/Não envie nem prometa link de Meet/);
  });
});

describe("contato informado", () => {
  it("exige nome e e-mail ou telefone real", () => {
    expect(parseContact({ nome: "Ana", email: null, telefone: null })).toBeNull();
    expect(parseContact({ nome: "Ana", email: null, telefone: "123" })).toBeNull();
  });
  it("rejeita dados que o visitante não escreveu", () => {
    const user = ["Oi, sou a Ana Souza", "meu zap é (11) 98888-7777"];
    expect(contactFromUserMessages({ nome: "Ana Souza", email: null, telefone: "11988887777" }, user)).not.toBeNull();
    expect(contactFromUserMessages({ nome: "Ana Souza", email: null, telefone: "11977776666" }, user)).toBeNull();
    expect(contactFromUserMessages({ nome: "Ana Souza", email: "ana@x.com", telefone: null }, user)).toBeNull();
    expect(contactFromUserMessages({ nome: "Maria", email: null, telefone: "11988887777" }, user)).toBeNull();
  });
});

describe("origem e acesso", () => {
  const url = "https://lar-sync-crm.lovable.app/api/public/clara-chat";
  it("exige Origin do mesmo site ou domínio conhecido", () => {
    expect(isAllowedOrigin(null, url)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", url)).toBe(false);
    expect(isAllowedOrigin("https://lar-sync-crm.lovable.app", url)).toBe(true);
    expect(isAllowedOrigin("https://myhub.katsuki.com.br", url)).toBe(true);
  });
  it("Hub > Chat web só para gestor/super admin com empresa 38 ativa", () => {
    expect(canSeeWebChat("manager", 38)).toBe(true);
    expect(canSeeWebChat("super_admin", 38)).toBe(true);
    expect(canSeeWebChat("manager", 25)).toBe(false);
    expect(canSeeWebChat("agent", 38)).toBe(false);
  });
});

describe("transporte e ferramentas", () => {
  it("ponte: cria job, envia só job_id/token e força o modelo", async () => {
    const { n8nBridgeTransport, BRIDGE_URL } = await import("./clara-chat.server");
    const rpc: any[] = []; const posts: any[] = [];
    const t = n8nBridgeTransport({ rpc: async (fn: string, args: any) => { rpc.push({ fn, args }); return { data: { job_id: "j1", token: "tk" }, error: null }; } },
      (async (url: string, init: any) => { posts.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })); }) as any);
    await t({ model: "outro", temperature: 1, messages: [] }, AbortSignal.timeout(1000));
    expect(rpc[0].fn).toBe("clara_web_inference_create");
    expect(rpc[0].args.p_payload).toMatchObject({ model: "gpt-4.1", temperature: 0.5, max_tokens: 1800, stream: false });
    expect(posts).toEqual([{ url: BRIDGE_URL, body: { job_id: "j1", token: "tk" } }]);
  });
  it("ponte: sem RPC de job, não chama o webhook", async () => {
    const { n8nBridgeTransport, ClaraNotConfiguredError } = await import("./clara-chat.server");
    let posted = false;
    const t = n8nBridgeTransport({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, (async () => { posted = true; return new Response("{}"); }) as any);
    await expect(t({ messages: [] }, AbortSignal.timeout(1000))).rejects.toBeInstanceOf(ClaraNotConfiguredError);
    expect(posted).toBe(false);
  });
  it("contato inventado pelo modelo não chega ao banco", async () => {
    const { createToolRunner } = await import("./clara-chat.server");
    const calls: any[] = [];
    const run = createToolRunner({ admin: { rpc: async (fn: string, a: any) => { calls.push({ fn, a }); return { data: { outcome: "saved" }, error: null }; } },
      tokenHash: "h", requestId: "r", leaseToken: "l", userTexts: ["sou a Ana"] });
    expect(await run("registrar_contato", { nome: "Ana", email: null, telefone: "11988887777" })).toMatchObject({ outcome: "invalid" });
    expect(calls).toHaveLength(0);
  });
  it("laço de ferramentas devolve o texto final", async () => {
    const { generateClaraReply } = await import("./clara-chat.server");
    const replies = [
      { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "consultar_horarios", arguments: "{\"dia\":null,\"periodo\":\"manha\"}" } }] } }] },
      { choices: [{ message: { role: "assistant", content: "Tenho 9h amanhã." } }] },
    ];
    let i = 0; const tools: string[] = [];
    const out = await generateClaraReply({ system: "S", history: [{ role: "user", content: "oi" }], greeting: false, model: "gpt-4.1", temperature: 0.5,
      transport: async () => replies[i++], runTool: async (n) => { tools.push(n); return { outcome: "available" }; } });
    expect(out.text).toBe("Tenho 9h amanhã.");
    expect(tools).toEqual(["consultar_horarios"]);
  });
});

const SQL = readFileSync(join(__dirname, "..", "..", "docs", "clara-chat-candidato.sql"), "utf8");
const core = SQL.slice(SQL.indexOf("-- === pglite-core-begin ==="), SQL.indexOf("-- === pglite-core-end ==="));
const H = (c: string) => c.repeat(64);
const rid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema private;
create table public.empresa_dados (id bigint primary key); insert into public.empresa_dados values (38);
create function public.crm_phone_match_key(p text) returns text language sql immutable as $$ select right(regexp_replace(coalesce(p,''),'[^0-9]','','g'), 8) $$;
create table public.crm_leads (id bigserial primary key, id_empresa bigint not null, nome text not null, telefone text not null, email text,
  origem text not null default 'ND', qualificado smallint default 0, observacoes text, id_empreendimento bigint);
create table private.hub_queue_intake (lead_id bigint primary key, id_empresa bigint);
create function private.intake() returns trigger language plpgsql as $$ begin insert into private.hub_queue_intake values (new.id, new.id_empresa); return new; end $$;
create trigger hub_capture_queue_intake_insert after insert on public.crm_leads for each row execute function private.intake();
create table public.lead (id bigserial primary key, id_empresa bigint not null, nome text not null, numero text, email text, id_crm text, atendimento_humano boolean);
create table public.crm_lead_activities (id bigserial primary key, lead_id bigint not null, crm_user_id uuid, tipo text not null, descricao text, metadata jsonb);
create function public.crm_get_or_create_ai_user(p bigint) returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
create function public.crm_can_manage_empresa(p bigint) returns boolean language sql as $$ select current_setting('app.can_manage', true) = 'on' $$;
create table public.sched_calls (lead bigint, op text, req text);
create function public.commercial_schedule_options(p_company bigint, p_lead bigint, p_from date, p_period text) returns jsonb language sql as
  $$ select jsonb_build_object('outcome','available','lead',p_lead) $$;
create function public.commercial_schedule_manage(p_company bigint, p_lead bigint, p_action text, p_day date, p_time time, p_booking bigint, p_revision int, p_request text)
  returns jsonb language plpgsql as $$ begin insert into public.sched_calls values (p_lead, p_action, p_request); return jsonb_build_object('outcome','created'); end $$;
`;

describe("SQL candidato (PGlite)", () => {
  let db: PGlite;
  const call = async (fn: string, args: unknown[]) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(",");
    return ((await db.query(`select public.${fn}(${ph}) r`, args)).rows[0] as any).r;
  };
  const open = (tok = "a") => call("web_chat_open", [38, H(tok), H("f")]);
  const begin = (r: string, kind: string, text: string | null) => call("web_chat_begin", [38, H("a"), H("f"), r, kind, text]);
  const finish = (r: string, lease: string, reply: string) => call("web_chat_finish", [38, H("a"), r, lease, reply]);
  const save = (r: string, lease: string, nome: string, email: string | null, tel: string | null) =>
    call("web_chat_save_contact", [38, H("a"), r, lease, nome, email, tel]);

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(FIXTURE);
    await db.exec(core.replace("create schema if not exists private;", ""));
    await db.exec(`insert into private.web_chat_config (empresa_id, enabled) values (38, true)`);
  });

  it("abertura acontece uma vez, mesmo com outro requestId", async () => {
    await open();
    const b = await begin(rid(1), "greeting", null);
    expect((await finish(rid(1), b.lease_token, "Oi, sou a Clara")).status).toBe("done");
    expect((await begin(rid(2), "greeting", null)).status).toBe("done");
    expect((await open()).messages).toHaveLength(1);
  });

  it("retry devolve a resposta salva; mesmo requestId com outro texto é inválido", async () => {
    await open();
    const b = await begin(rid(1), "message", "Olá");
    await finish(rid(1), b.lease_token, "Resposta");
    expect((await begin(rid(1), "message", "Olá")).reply.content).toBe("Resposta");
    expect((await begin(rid(1), "message", "Outro texto")).status).toBe("invalid");
  });

  it("tentativa expirada não sobrescreve a nova execução do mesmo request", async () => {
    await open();
    const first = await begin(rid(1), "message", "a");
    await db.exec(`update private.web_chat_sessions set lease_until = now() - interval '1 second'`);
    expect((await finish(rid(1), first.lease_token, "velha")).status).toBe("lease_lost");
    const second = await begin(rid(1), "message", "a");
    expect(second.status).toBe("proceed");
    expect(second.lease_token).not.toBe(first.lease_token);
    expect((await finish(rid(1), first.lease_token, "velha")).status).toBe("lease_lost");
    expect((await finish(rid(1), second.lease_token, "nova")).reply.content).toBe("nova");
  });

  it("lease ativo bloqueia outra geração", async () => {
    await open();
    await begin(rid(1), "message", "a");
    expect((await begin(rid(2), "message", "b")).status).toBe("busy");
  });

  it("falhas e retries contam no limite da sessão", async () => {
    await open();
    for (let i = 0; i < 10; i++) {
      const b = await begin(rid(100 + i), "message", "m"); await finish(rid(100 + i), b.lease_token, "");
      const b2 = await begin(rid(100 + i), "message", "m"); await finish(rid(100 + i), b2.lease_token, "ok");
    }
    expect((await begin(rid(2), "message", "m")).status).toBe("rate_limited");
  });

  it("limita criação de sessões por IP", async () => {
    for (const t of "0123456789") expect((await open(t)).status).toBe("ok");
    expect((await open("e")).status).toBe("rate_limited");
  });

  it("só e-mail fica na sessão; telefone promove ao CRM sem fila e com atividade", async () => {
    await open();
    const b = await begin(rid(1), "message", "Ana, ana@x.com");
    expect(await save(rid(1), b.lease_token, "Ana", "ana@x.com", null)).toMatchObject({ crm: "none" });
    expect((await db.query(`select count(*)::int n from public.crm_leads`)).rows[0]).toEqual({ n: 0 });
    expect(await save(rid(1), b.lease_token, "Ana", null, "11988887777")).toMatchObject({ crm: "promoted" });
    const crm = (await db.query(`select origem, id_empreendimento, qualificado from public.crm_leads`)).rows;
    expect(crm).toEqual([{ origem: "SI", id_empreendimento: null, qualificado: 0 }]);
    expect((await db.query(`select count(*)::int n from private.hub_queue_intake`)).rows[0]).toEqual({ n: 0 });
    expect((await db.query(`select tipo from public.crm_lead_activities`)).rows).toEqual([{ tipo: "web_chat" }]);
    expect((await db.query(`select id_crm is not null ok from public.lead`)).rows).toEqual([{ ok: true }]);
  });

  it("telefone já existente não mescla nem cria lead", async () => {
    await db.exec(`insert into public.lead (id_empresa, nome, numero) values (38, 'Outra pessoa', '5511988887777')`);
    await open();
    const b = await begin(rid(1), "message", "x");
    expect(await save(rid(1), b.lease_token, "Ana", null, "11988887777")).toMatchObject({ crm: "phone_conflict" });
    expect((await db.query(`select count(*)::int n from public.crm_leads`)).rows[0]).toEqual({ n: 0 });
  });

  it("agenda exige sessão promovida e usa o lead novo, com chave estável", async () => {
    await open();
    const b = await begin(rid(1), "message", "x");
    const args = (op: string) => [38, H("a"), rid(1), b.lease_token, op, "2026-12-01", "10:00", null, null, null];
    expect(await call("web_chat_schedule", args("opcoes"))).toMatchObject({ outcome: "contact_required" });
    await save(rid(1), b.lease_token, "Ana", null, "11988887777");
    const lead = (await db.query(`select id from public.lead`)).rows[0] as any;
    expect(await call("web_chat_schedule", args("opcoes"))).toMatchObject({ outcome: "available", lead: Number(lead.id) });
    await call("web_chat_schedule", args("agendar"));
    await call("web_chat_schedule", args("agendar"));
    const calls = (await db.query(`select distinct lead, req from public.sched_calls`)).rows;
    expect(calls).toHaveLength(1);
  });

  it("ferramentas sem lease válido não executam", async () => {
    await open();
    const b = await begin(rid(1), "message", "x");
    expect(await save(rid(1), rid(999), "Ana", null, "11988887777")).toMatchObject({ outcome: "lease_lost" });
    await db.exec(`update private.web_chat_sessions set lease_until = now() - interval '1 second'`);
    expect(await save(rid(1), b.lease_token, "Ana", null, "11988887777")).toMatchObject({ outcome: "lease_lost" });
  });

  it("Hub: só quem gerencia a empresa lê as conversas", async () => {
    await expect(call("web_chat_hub_sessions", [38, 50, 0])).rejects.toThrow(/forbidden/);
    await db.exec(`set app.can_manage = 'on'`);
    expect(await call("web_chat_hub_sessions", [38, 50, 0])).toEqual([]);
  });

  it("anon/authenticated não executam o runtime nem leem tabelas", async () => {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(`select has_function_privilege($1, 'public.web_chat_begin(bigint,text,text,uuid,text,text)', 'execute') a,
        has_function_privilege($1, 'private.web_chat_save_contact(bigint,text,uuid,uuid,text,text,text)', 'execute') b,
        has_table_privilege($1, 'private.web_chat_messages', 'select') c`, [role]);
      expect(rows[0]).toEqual({ a: false, b: false, c: false });
    }
    const { rows } = await db.query(`select has_function_privilege('anon', 'public.web_chat_hub_sessions(bigint,int,int)', 'execute') a,
      has_function_privilege('authenticated', 'public.web_chat_hub_sessions(bigint,int,int)', 'execute') b`);
    expect(rows[0]).toEqual({ a: false, b: true });
  });
});
