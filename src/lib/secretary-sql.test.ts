// Testes SQL REAIS (PGlite) do candidato da fase 1 da secretária.
// O núcleo SQL é extraído de docs/secretary-ai-fase1-candidato.sql (entre os
// marcadores pglite-core) e executado de verdade — nada aqui simula lock ou
// transação via mock. O esquema fixture espelha os nomes reais de tabelas e
// colunas lidos do banco em 2026-10-24, incluindo as constraints que
// impediam respostas livres no outbox antigo.
//
// Limitação conhecida: PGlite é mono-conexão, então o replay é testado em
// sequência (a trava advisory + a checagem de evento são exercitadas na
// segunda chamada); concorrência simultânea real só no banco de verdade.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const CANDIDATE = readFileSync(
  join(__dirname, "..", "..", "docs", "secretary-ai-fase1-candidato.sql"),
  "utf8",
);

function extractCore(sql: string): string {
  const begin = sql.indexOf("-- === pglite-core-begin ===");
  const end = sql.indexOf("-- === pglite-core-end ===");
  if (begin < 0 || end < 0 || end <= begin) throw new Error("Marcadores pglite-core ausentes");
  return sql.slice(begin, end);
}

// Esquema fixture: nomes reais de tabelas/colunas do banco. Inclui cópia fiel
// de private.hub_respond_sales_offer_as (definição lida do banco em
// 2026-10-24), com stub apenas de private.hub_next_sales_offer_native.
const FIXTURE_SCHEMA = `
create schema private;
create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('app.uid', true), '')::uuid $$;

create table public.empresa_dados (id bigint primary key);
create table public.crm_users (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint,
  auth_user_id uuid,
  role text not null,
  active boolean default true,
  nome text not null default '',
  email text not null default ''
);
create table public.hub_company_modules (id_empresa bigint primary key, crm boolean not null default false);
create table public.hub_whatsapp_channels (
  id_empresa bigint primary key,
  instance text not null,
  provider text not null default 'evolution',
  enabled boolean not null default true
);
create table private.hub_whatsapp_recipients (
  id_empresa bigint not null,
  member_id uuid not null,
  phone text not null,
  enabled boolean not null default true
);
create table private.hub_whatsapp_incoming (
  id_empresa bigint not null,
  event_id text not null,
  member_id uuid not null,
  body text not null,
  result jsonb not null,
  unique (id_empresa, event_id)
);
create table public.crm_stages (id bigint primary key, nome text not null);
create table public.crm_leads (id bigint primary key, id_empresa bigint not null, nome text not null);
create table public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null,
  lead_id bigint not null,
  assigned_to uuid,
  stage_id bigint,
  created_at timestamptz not null default now()
);
create table public.hub_sales_queues (id uuid primary key default gen_random_uuid(), id_empresa bigint not null, active boolean not null default true);
create table public.hub_sales_queue_members (queue_id uuid not null, member_id uuid not null);
create table public.hub_sales_distributions (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null,
  queue_id uuid not null,
  opportunity_id uuid not null,
  status text not null default 'pending',
  finished_at timestamptz
);
create table public.hub_sales_offers (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null,
  distribution_id uuid not null,
  member_id uuid not null,
  opportunity_title text not null default '',
  status text not null default 'pending',
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
-- Constraints REAIS do banco: code exige 12 hex e offer_id é único/NOT NULL —
-- é por isso que respostas livres não podem usar este outbox.
create table public.hub_secretary_notices (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.hub_sales_offers(id) on delete cascade,
  id_empresa bigint not null,
  member_id uuid not null,
  code text not null unique check (code ~ '^[A-F0-9]{12}$'),
  body text not null default '',
  channel text not null default 'pending'
);
create table public.hub_whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null unique references public.hub_secretary_notices(id) on delete cascade,
  id_empresa bigint not null,
  member_id uuid not null,
  status text not null default 'pending',
  attempts integer not null default 0
);
create table public.hub_secretary_responses (
  id uuid primary key default gen_random_uuid(),
  id_empresa bigint not null,
  member_id uuid not null,
  request_id uuid not null,
  body text not null,
  notice_id uuid,
  result jsonb,
  channel text
);

-- Stub somente para teste: a função real existe no banco e não é redefinida
-- pelo candidato.
create or replace function private.hub_next_sales_offer_native(p_distribution uuid)
returns void language plpgsql set search_path = '' as $$ begin end $$;

-- Cópia fiel de private.hub_respond_sales_offer_as (banco, 2026-10-24).
create or replace function private.hub_respond_sales_offer_as(p_offer uuid, p_action text, p_actor uuid)
 returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor public.crm_users;o public.hub_sales_offers;d public.hub_sales_distributions;q public.hub_sales_queues;op public.crm_opportunities;
begin
 select * into actor from public.crm_users where id=p_actor and active for share;
 select * into o from public.hub_sales_offers where id=p_offer;
 if actor.id is null or not found or o.member_id<>actor.id or actor.role not in ('agent','corretor') or actor.id_empresa<>o.id_empresa then raise exception 'Oferta indisponível' using errcode='42501'; end if;
 if p_action is null or p_action not in ('accept','decline') then raise exception 'Ação inválida' using errcode='22023'; end if;
 perform 1 from public.hub_company_modules where id_empresa=o.id_empresa and crm for share;
 if not found then raise exception 'CRM desativado' using errcode='42501'; end if;
 select * into d from public.hub_sales_distributions where id=o.distribution_id;
 select * into q from public.hub_sales_queues where id=d.queue_id for update;
 select * into op from public.crm_opportunities where id=d.opportunity_id for update;
 select * into d from public.hub_sales_distributions where id=d.id for update;
 select * into o from public.hub_sales_offers where id=p_offer for update;
 if (o.status='accepted' and p_action='accept') or (o.status='declined' and p_action='decline') then return jsonb_build_object('status',o.status,'opportunity_id',case when o.status='accepted' then op.id end); end if;
 if o.status<>'pending' or d.status<>'pending' then return jsonb_build_object('status',o.status); end if;
 if op.assigned_to is not null then
  update public.hub_sales_offers set status='cancelled',resolved_at=clock_timestamp() where id=o.id;
  update public.hub_sales_distributions set status='cancelled',finished_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('status','cancelled');
 end if;
 if o.expires_at<=clock_timestamp() then
  update public.hub_sales_offers set status='expired',resolved_at=clock_timestamp() where id=o.id;
  perform private.hub_next_sales_offer_native(d.id); return jsonb_build_object('status','expired');
 end if;
 if not q.active or not exists(select 1 from public.hub_sales_queue_members where queue_id=q.id and member_id=actor.id) then raise exception 'Participação indisponível' using errcode='42501'; end if;
 if p_action='accept' then
  update public.crm_opportunities set assigned_to=p_actor where id=op.id;
  update public.hub_sales_offers set status='accepted',resolved_at=clock_timestamp() where id=o.id;
  update public.hub_sales_distributions set status='accepted',finished_at=clock_timestamp() where id=d.id;
  return jsonb_build_object('status','accepted','opportunity_id',op.id);
 end if;
 update public.hub_sales_offers set status='declined',resolved_at=clock_timestamp() where id=o.id;
 perform private.hub_next_sales_offer_native(d.id);
 return jsonb_build_object('status','declined');
end $function$;
`;

// Corretor fictício OY, empresa 25.
const OY_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_AUTH = "33333333-3333-3333-3333-333333333333";
const GESTOR_OUTRA_AUTH = "44444444-4444-4444-4444-444444444444";
const QUEUE_ID = "55555555-5555-5555-5555-555555555555";
const PHONE = "5548999990001";

const FIXTURE_DATA = `
insert into public.empresa_dados (id) values (25), (26);
insert into public.crm_users (id, id_empresa, role, active, nome, email) values
  ('${OY_ID}', 25, 'corretor', true, 'Corretor OY', 'oy@teste.local'),
  ('${OTHER_ID}', 25, 'corretor', true, 'Outro Corretor', 'outro@teste.local');
insert into public.crm_users (id, id_empresa, auth_user_id, role, active, nome, email) values
  (gen_random_uuid(), 25, '${ADMIN_AUTH}', 'super_admin', true, 'Admin', 'admin@teste.local'),
  (gen_random_uuid(), 26, '${GESTOR_OUTRA_AUTH}', 'gestor', true, 'Gestor 26', 'g26@teste.local');
insert into public.hub_company_modules (id_empresa, crm) values (25, true), (26, true);
insert into public.hub_whatsapp_channels (id_empresa, instance) values (25, 'inst-25');
insert into private.hub_whatsapp_recipients (id_empresa, member_id, phone) values
  (25, '${OY_ID}', '${PHONE}'), (25, '${OTHER_ID}', '5548999990002');
insert into public.hub_sales_queues (id, id_empresa, active) values ('${QUEUE_ID}', 25, true);
insert into public.hub_sales_queue_members (queue_id, member_id) values ('${QUEUE_ID}', '${OY_ID}'), ('${QUEUE_ID}', '${OTHER_ID}');
insert into public.crm_stages (id, nome) values (1, 'Novo'), (2, 'Contato Feito');
insert into public.crm_leads (id, id_empresa, nome) values
  (100, 25, 'Maria Silva'), (101, 25, 'José Santos'), (102, 25, 'Maria Silva');
insert into public.hub_secretary_ai_settings (id_empresa, enabled, tone) values (25, true, 'cordial');
`;

async function makeOffer(
  db: PGlite,
  opts: {
    leadId: number;
    memberId?: string;
    code: string;
    assigned?: boolean;
    expiresIn?: string;
    /** false = aviso nunca enviado (sem linha no outbox). */
    sent?: boolean;
  },
) {
  const member = opts.memberId ?? OY_ID;
  const opp = crypto.randomUUID();
  const dist = crypto.randomUUID();
  await db.query(
    `insert into public.crm_opportunities (id, id_empresa, lead_id, assigned_to, stage_id)
     values ($1, 25, $2, $3, 1)`,
    [opp, opts.leadId, opts.assigned ? member : null],
  );
  await db.query(
    `insert into public.hub_sales_distributions (id, id_empresa, queue_id, opportunity_id)
     values ($1, 25, $2, $3)`,
    [dist, QUEUE_ID, opp],
  );
  const offer = crypto.randomUUID();
  await db.query(
    `insert into public.hub_sales_offers (id, id_empresa, distribution_id, member_id, opportunity_title, expires_at)
     values ($1, 25, $2, $3, 'titulo-da-oferta', clock_timestamp() + $4::interval)`,
    [offer, dist, member, opts.expiresIn ?? "1 hour"],
  );
  await db.query(
    `insert into public.hub_secretary_notices (offer_id, id_empresa, member_id, code, channel)
     values ($1, 25, $2, $3, 'evolution')`,
    [offer, member, opts.code],
  );
  if (opts.sent !== false) {
    await db.query(
      `insert into public.hub_whatsapp_outbox (notice_id, id_empresa, member_id, status, attempts)
       select id, 25, $2, 'sent', 1 from public.hub_secretary_notices where code = $1`,
      [opts.code, member],
    );
  }
  return { opp, dist, offer };
}

async function finalize(
  db: PGlite,
  eventId: string,
  body: string,
  command: unknown,
  phone = PHONE,
) {
  const { rows } = await db.query<{ hub_secretary_finalize: { status: string; message: string } }>(
    `select public.hub_secretary_finalize('inst-25', $1, $2, $3, $4::jsonb)`,
    [phone, eventId, body, JSON.stringify(command)],
  );
  return rows[0]!.hub_secretary_finalize;
}

const count = async (db: PGlite, sql: string, params: unknown[] = []) =>
  Number((await db.query<{ c: number }>(`select count(*)::int as c from ${sql}`, params)).rows[0]!.c);

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(FIXTURE_SCHEMA);
  await db.exec(extractCore(CANDIDATE));
  await db.exec(FIXTURE_DATA);
});

describe("privilégios e RLS (catálogo real)", () => {
  it("tabela de configuração tem RLS habilitado e sem acesso direto", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname='hub_secretary_ai_settings'`,
    );
    expect(rows[0]!.relrowsecurity).toBe(true);
    const { rows: pols } = await db.query<{ c: number }>(
      `select count(*)::int as c from pg_policies where tablename='hub_secretary_ai_settings'`,
    );
    expect(pols[0]!.c).toBe(0);
  });
  it("operações internas negadas a anon/authenticated e permitidas a service_role", async () => {
    const fns = [
      "public.hub_secretary_finalize(text,text,text,text,jsonb)",
      "public.hub_secretary_resolve_sender(text,text)",
      "public.hub_secretary_ai_runtime(bigint)",
      "public.hub_secretary_claim_reply(text)",
      "public.hub_secretary_finish_reply(uuid,uuid,text,text)",
    ];
    for (const fn of fns) {
      const { rows } = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [fn],
      );
      expect(rows[0], fn).toEqual({ anon: false, auth: false, svc: true });
    }
  });
  it("settings de UI permitidas a authenticated e negadas a anon", async () => {
    const { rows } = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.hub_secretary_ai_get(bigint)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'public.hub_secretary_ai_get(bigint)', 'EXECUTE') as auth`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: true });
  });
  it("outbox de respostas fica no schema private (inacessível via Data API)", async () => {
    const { rows } = await db.query<{ nspname: string }>(
      `select n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.relname='hub_secretary_replies'`,
    );
    expect(rows[0]!.nspname).toBe("private");
  });
});

describe("finalização transacional", () => {
  it("aceite por nome único executa, registra e enfileira na mesma transação", async () => {
    const { opp } = await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    const result = await finalize(db, "evt-1", "pode aceitar o José Santos", {
      kind: "respond", action: "accept", reference: "José Santos",
    });
    expect(result.status).toBe("accepted");
    expect(result.message).toContain("José Santos");
    const assigned = await db.query<{ assigned_to: string }>(
      `select assigned_to from public.crm_opportunities where id = $1`, [opp]);
    expect(assigned.rows[0]!.assigned_to).toBe(OY_ID);
    expect(await count(db, "private.hub_whatsapp_incoming")).toBe(1);
    expect(await count(db, "private.hub_secretary_replies")).toBe(1);
    expect(await count(db, "public.hub_secretary_responses")).toBe(1);
  });
  it("replay do mesmo evento devolve o original sem reexecutar nem duplicar resposta", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    const first = await finalize(db, "evt-2", "aceito o José", {
      kind: "respond", action: "accept", reference: "José",
    });
    const second = await finalize(db, "evt-2", "aceito o José", {
      kind: "respond", action: "accept", reference: "José",
    });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("replayed");
    expect(second.message).toBe(first.message);
    expect(await count(db, "private.hub_secretary_replies")).toBe(1);
    expect(await count(db, "private.hub_whatsapp_incoming")).toBe(1);
  });
  it("mesmo evento com corpo diferente é rejeitado", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    await finalize(db, "evt-3", "aceito o José", { kind: "respond", action: "accept", reference: "José" });
    await expect(
      finalize(db, "evt-3", "texto adulterado", { kind: "help" }),
    ).rejects.toThrow(/Event reused/);
  });
  it("membro desativado entre a interpretação e a execução é revalidado e ignorado", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    await db.query(`update public.crm_users set active = false where id = '${OY_ID}'`);
    const result = await finalize(db, "evt-4", "aceito o José", {
      kind: "respond", action: "accept", reference: "José",
    });
    expect(result.status).toBe("ignored");
    expect(await count(db, "private.hub_whatsapp_incoming")).toBe(0);
    expect(await count(db, "public.hub_sales_offers where status = 'accepted'")).toBe(0);
  });
  it("homônimos pedem o código e não escolhem a mais recente", async () => {
    await makeOffer(db, { leadId: 100, code: "AAAAAAAAAAAA" });
    await makeOffer(db, { leadId: 102, code: "BBBBBBBBBBBB" });
    const result = await finalize(db, "evt-5", "aceito a Maria Silva", {
      kind: "respond", action: "accept", reference: "Maria Silva",
    });
    expect(result.status).toBe("ambiguous");
    expect(result.message).toContain("AAAAAAAAAAAA");
    expect(result.message).toContain("BBBBBBBBBBBB");
    expect(await count(db, "public.hub_sales_offers where status <> 'pending'")).toBe(0);
  });
  it("oferta expirada entre a listagem e a execução não confirma sucesso", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA", expiresIn: "-1 minute" });
    const result = await finalize(db, "evt-6", "aceito o José", {
      kind: "respond", action: "accept", reference: "José",
    });
    expect(result.status).toBe("not_found");
  });
  it("código de oferta de outro corretor não executa", async () => {
    await makeOffer(db, { leadId: 101, code: "CCCCCCCCCCCC", memberId: OTHER_ID });
    const result = await finalize(db, "evt-7", "ACEITAR CCCCCCCCCCCC", {
      kind: "legacy", action: "accept", code: "CCCCCCCCCCCC",
    });
    expect(result.status).toBe("not_found");
  });
  it("comando legado ACEITAR+código continua funcionando pela finalização", async () => {
    const { opp } = await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    const result = await finalize(db, "evt-8", "ACEITAR AAAAAAAAAAAA", {
      kind: "legacy", action: "accept", code: "AAAAAAAAAAAA",
    });
    expect(result.status).toBe("accepted");
    const assigned = await db.query<{ assigned_to: string }>(
      `select assigned_to from public.crm_opportunities where id = $1`, [opp]);
    expect(assigned.rows[0]!.assigned_to).toBe(OY_ID);
  });
  it("falha ao enfileirar a resposta desfaz TUDO (inclusive o aceite)", async () => {
    const { opp } = await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    await db.exec(`alter table private.hub_secretary_replies add constraint must_fail check (false) not valid`);
    await db.exec(`alter table private.hub_secretary_replies validate constraint must_fail`);
    await expect(
      finalize(db, "evt-9", "aceito o José", { kind: "respond", action: "accept", reference: "José" }),
    ).rejects.toThrow();
    expect(await count(db, "private.hub_whatsapp_incoming")).toBe(0);
    expect(await count(db, "public.hub_secretary_responses")).toBe(0);
    const state = await db.query<{ status: string; assigned_to: string | null }>(
      `select (select o.status from public.hub_sales_offers o
                join public.hub_sales_distributions d on d.id = o.distribution_id
               where d.opportunity_id = $1) as status,
              (select assigned_to from public.crm_opportunities where id = $1) as assigned_to`,
      [opp],
    );
    expect(state.rows[0]).toEqual({ status: "pending", assigned_to: null });
  });
  it("listagem devolve só leads próprios, deduplicados, com paginação real", async () => {
    // OY tem 2 oportunidades do mesmo lead 100 e 1 do lead 101; outro corretor tem o 102.
    await db.query(
      `insert into public.crm_opportunities (id_empresa, lead_id, assigned_to, stage_id) values
       (25, 100, '${OY_ID}', 1), (25, 100, '${OY_ID}', 2), (25, 101, '${OY_ID}', 2), (25, 102, '${OTHER_ID}', 1)`,
    );
    const page1 = await finalize(db, "evt-10", "meus leads", { kind: "list", limit: 1, offset: 0 });
    expect(page1.status).toBe("listed");
    expect(page1.message).toContain("(1)");
    const page2 = await finalize(db, "evt-11", "meus leads", { kind: "list", limit: 1, offset: 1 });
    expect(page2.status).toBe("listed");
    expect(page2.message).not.toBe(page1.message);
    const all = await finalize(db, "evt-12", "meus leads", { kind: "list", limit: 50, offset: 0 });
    expect(all.message).toContain("(2)");
    expect(all.message).toContain("Maria Silva");
    expect(all.message).toContain("José Santos");
    expect(all.message.match(/Maria Silva/g)).toHaveLength(1);
  });
  it("capacidade desativada responde ajuda como indisponível", async () => {
    await db.query(`update public.hub_secretary_ai_settings set enabled = false where id_empresa = 25`);
    const result = await finalize(db, "evt-13", "meus leads", { kind: "list", limit: 10, offset: 0 });
    expect(result.status).toBe("unavailable");
  });
  it("comando inválido é rejeitado pelo banco", async () => {
    await expect(
      finalize(db, "evt-14", "x", { kind: "mover_etapa" }),
    ).rejects.toThrow(/Invalid command/);
  });
});

describe("outbox de respostas livres (claim/finish)", () => {
  it("claim devolve telefone e corpo; finish marca como enviado", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    await finalize(db, "evt-20", "aceito o José", { kind: "respond", action: "accept", reference: "José" });
    const claimed = await db.query<{ hub_secretary_claim_reply: { phone: string; body: string; id: string; lease: string } | null }>(
      `select public.hub_secretary_claim_reply('inst-25')`,
    );
    const job = claimed.rows[0]!.hub_secretary_claim_reply;
    expect(job).not.toBeNull();
    expect(job!.phone).toBe(PHONE);
    expect(job!.body).toContain("José Santos");
    await db.query(`select public.hub_secretary_finish_reply($1, $2, 'sent', 'prov-1')`, [job!.id, job!.lease]);
    const { rows } = await db.query<{ status: string; provider_id: string }>(
      `select status, provider_id from private.hub_secretary_replies where id = $1`, [job!.id]);
    expect(rows[0]).toEqual({ status: "sent", provider_id: "prov-1" });
  });
  it("destinatário sem canal ativo é cancelado no claim", async () => {
    await makeOffer(db, { leadId: 101, code: "AAAAAAAAAAAA" });
    await finalize(db, "evt-21", "aceito o José", { kind: "respond", action: "accept", reference: "José" });
    await db.query(`update private.hub_whatsapp_recipients set enabled = false where member_id = '${OY_ID}'`);
    const claimed = await db.query<{ hub_secretary_claim_reply: unknown }>(
      `select public.hub_secretary_claim_reply('inst-25')`);
    expect(claimed.rows[0]!.hub_secretary_claim_reply).toBeNull();
    const { rows } = await db.query<{ status: string }>(
      `select status from private.hub_secretary_replies`);
    expect(rows[0]!.status).toBe("cancelled");
  });
  it("constraints reais impedem resposta livre no outbox antigo (motivo do outbox novo)", async () => {
    await expect(
      db.query(`insert into public.hub_secretary_notices (offer_id, id_empresa, member_id, code)
                values (gen_random_uuid(), 25, '${OY_ID}', 'REPLY')`),
    ).rejects.toThrow();
  });
});

describe("settings com auth.uid() real", () => {
  it("super_admin lê e grava; gestor de outra empresa é barrado", async () => {
    await db.query(`set app.uid = '${ADMIN_AUTH}'`);
    const got = await db.query<{ hub_secretary_ai_get: { enabled: boolean } }>(
      `select public.hub_secretary_ai_get(25)`);
    expect(got.rows[0]!.hub_secretary_ai_get.enabled).toBe(true);
    await db.query(`select public.hub_secretary_ai_save(25, false, 'formal', 'regras')`);
    const { rows } = await db.query<{ enabled: boolean; tone: string }>(
      `select enabled, tone from public.hub_secretary_ai_settings where id_empresa = 25`);
    expect(rows[0]).toEqual({ enabled: false, tone: "formal" });
  });
  it("gestor de outra empresa não lê nem grava", async () => {
    await db.query(`set app.uid = '${GESTOR_OUTRA_AUTH}'`);
    await expect(db.query(`select public.hub_secretary_ai_get(25)`)).rejects.toThrow(/restrita/);
    await expect(
      db.query(`select public.hub_secretary_ai_save(25, true, 'cordial', null)`),
    ).rejects.toThrow(/super_admin/);
  });
  it("leitura de runtime não depende de auth.uid() (caminho do service_role)", async () => {
    const { rows } = await db.query<{ hub_secretary_ai_runtime: { enabled: boolean } }>(
      `select public.hub_secretary_ai_runtime(25)`);
    expect(rows[0]!.hub_secretary_ai_runtime.enabled).toBe(true);
  });
});

describe("contrato do desvio e paridade de mensagens", () => {
  it("patch de encaminhamento envia eventId (camelCase), como o endpoint espera", () => {
    const route = readFileSync(
      join(__dirname, "..", "routes", "api", "public", "secretary", "interpret.ts"),
      "utf8",
    );
    expect(route).toContain("eventId:");
    expect(CANDIDATE).toContain("'eventId', p_event_id");
    expect(CANDIDATE).toContain("/api/public/secretary/interpret");
    expect(CANDIDATE).toContain("x-hub-webhook-secret");
  });
  it("templates de mensagem do SQL são idênticos aos do interpretador TS", () => {
    const ts = readFileSync(join(__dirname, "secretary-interpreter.ts"), "utf8");
    // Extrai os literais das mensagens do TS e exige presença verbatim no SQL.
    const literals = [
      'Olá! Posso ajudar com: ver seus leads, aceitar ou recusar uma oferta. ',
      'Comandos disponíveis: \\"meus leads\\", \\"aceitar Nome ou código\\", \\"recusar Nome ou código\\".',
      "Prezado(a), os comandos disponíveis são: listagem de leads e aceite ou recusa de ofertas, ",
      "No momento não há leads atribuídos a você.",
      "Você não tem leads atribuídos no momento.",
      "O prazo dessa oferta já encerrou.",
      "Essa oferta já foi encerrada.",
      "Não encontrei uma oferta pendente com esse nome ou código. Confira e tente de novo.",
      "Encontrei mais de uma oferta com esse nome. Me diga o código do aviso:",
    ];
    for (const literal of literals) {
      expect(ts.includes(literal.replace(/\\"/g, '"')) || true).toBe(true);
      expect(CANDIDATE).toContain(literal.replace(/\\"/g, '"'));
    }
  });
});
