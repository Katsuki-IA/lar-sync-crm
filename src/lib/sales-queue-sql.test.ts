import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
const candidate = readFileSync(
  new URL("../../docs/distribution-v2-candidate.sql", import.meta.url),
  "utf8",
);
const originals = readFileSync(
  new URL("../../docs/distribution-v2-original-functions.sql", import.meta.url),
  "utf8",
);
const Q = "10000000-0000-0000-0000-000000000001",
  Q2 = "10000000-0000-0000-0000-000000000002";
const A = "20000000-0000-0000-0000-000000000001",
  B = "20000000-0000-0000-0000-000000000002",
  M = "20000000-0000-0000-0000-000000000003";
const OP = "30000000-0000-0000-0000-000000000001";
let db: PGlite;
const fixture = `
create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.crm_users(id uuid primary key,auth_user_id uuid,id_empresa bigint,nome text,active boolean,role text);
create table public.hub_company_modules(id_empresa bigint primary key,crm boolean);
create table public.empreendimento(id bigint primary key,id_empresa bigint,nome text);
create table public.crm_stages(id bigint primary key,id_empresa bigint,module text,ativo boolean,nome text);
create table public.crm_leads(id bigint primary key,id_empresa bigint,nome text,id_empreendimento bigint,qualificado smallint,crm_stage_id bigint);
create table public.crm_opportunities(id uuid primary key,id_empresa bigint,lead_id bigint,title text,assigned_to uuid);
create table public.hub_sales_queues(id uuid primary key default gen_random_uuid(),id_empresa bigint,name text,active boolean default true,
timeout_minutes integer default 10,cursor_position integer default 0,revision integer default 1,request_id uuid,creation_payload jsonb,created_at timestamptz default now(),unique(id_empresa,request_id));
create table public.hub_sales_queue_members(queue_id uuid,id_empresa bigint,member_id uuid,position integer,primary key(queue_id,member_id));
create table public.hub_sales_distributions(id uuid primary key default gen_random_uuid(),id_empresa bigint,queue_id uuid,opportunity_id uuid,status text default 'pending',created_by uuid not null,request_id uuid not null,created_at timestamptz default now(),finished_at timestamptz,unique(id_empresa,request_id));
create unique index one_pending_distribution on public.hub_sales_distributions(opportunity_id) where status='pending';
create table public.hub_sales_offers(id uuid primary key default gen_random_uuid(),id_empresa bigint,distribution_id uuid,member_id uuid,opportunity_title text,status text default 'pending',created_at timestamptz default now(),expires_at timestamptz,resolved_at timestamptz,unique(distribution_id,member_id));
create unique index one_pending_offer on public.hub_sales_offers(distribution_id) where status='pending';
create table public.hub_sales_queue_events(queue_id uuid,id_empresa bigint,actor_id uuid,before_data jsonb,after_data jsonb);
create table private.sales_worker_failures(distribution_id uuid primary key,attempts integer,last_sqlstate text,next_attempt_at timestamptz,updated_at timestamptz);
create table private.sales_worker_runs(started_at timestamptz,finished_at timestamptz,processed integer,failed integer,skipped integer);
create function private.hub_sales_module_enabled(bigint) returns boolean language sql as $$select exists(select 1 from public.hub_company_modules where id_empresa=$1 and crm)$$;
create function private.hub_sales_actor_id() returns uuid language sql as $$select id from public.crm_users where auth_user_id=auth.uid() and active$$;
`;
async function rows(sql: string, params: any[] = []) {
  return (await db.query<any>(sql, params)).rows;
}
async function addQueue(id = Q, development: number | null = null, qualified = true) {
  await db.query(
    `insert into hub_sales_queues(id,id_empresa,name,development_id,trigger_qualified) values($1,1,'Fila teste',$2,$3)`,
    [id, development, qualified],
  );
  await db.query(
    "insert into hub_sales_queue_members(queue_id,id_empresa,member_id,position) values($1,1,$2,1),($1,1,$3,2)",
    [id, A, B],
  );
}
async function addOp() {
  await db.query(`insert into crm_opportunities values($1,1,1,'Oportunidade teste',null)`, [OP]);
}
const rules = {
  development_id: 10,
  trigger_qualified: true,
  trigger_stage_ids: [10],
  schedule_enabled: true,
  weekdays: [1, 2, 3, 4, 5],
  starts_at: "08:00",
  ends_at: "18:00",
  priority: 1,
};
async function save(r: any = rules, request = "40000000-0000-0000-0000-000000000001") {
  return rows(
    "select * from private.hub_save_sales_queue_v2(1,null,'Teste',10,$1::uuid[],true,null,$2,$3)",
    [[A, B], request, JSON.stringify(r)],
  );
}
describe("filas v2 — SQL real com esquema mínimo compatível", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(fixture);
    await db.exec(originals);
    await db.exec(candidate);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec(
      "truncate hub_sales_offers,hub_sales_distributions,hub_sales_queue_members,hub_sales_queue_events,hub_sales_queues,crm_opportunities,crm_leads,crm_users,hub_company_modules,empreendimento,crm_stages,private.hub_sales_waiting cascade",
    );
    await db.query(
      `insert into crm_users values($1,$1,1,'A',true,'corretor'),($2,$2,1,'B',true,'agent'),($3,$3,1,'Gestor',true,'gestor')`,
      [A, B, M],
    );
    await db.query("select set_config('test.actor',$1,false)", [M]);
    await db.exec(
      "insert into hub_company_modules values(1,true),(2,true);insert into empreendimento values(10,1,'X'),(20,2,'Outra');insert into crm_stages values(10,1,'ia',true,'Qualificado'),(20,2,'ia',true,'Outra');insert into crm_leads values(1,1,'Lead',10,1,10)",
    );
  });
  it("respeita Brasília, dias e fim exclusivo", async () => {
    await addQueue();
    await db.exec(
      `update hub_sales_queues set schedule_enabled=true,weekdays='{1}',starts_at='08:00',ends_at='18:00'`,
    );
    for (const [t, open] of [
      ["2026-10-26T10:59:00Z", false],
      ["2026-10-26T11:00:00Z", true],
      ["2026-10-26T21:00:00Z", false],
      ["2026-10-27T11:00:00Z", false],
    ] as const) {
      expect((await rows("select private.hub_queue_is_open($1,$2) value", [Q, t]))[0].value).toBe(
        open,
      );
    }
  });
  it("sem fila aguarda; fila criada depois capta sem duplicar", async () => {
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(0);
    await addQueue();
    await db.exec("update private.hub_sales_waiting set next_attempt_at=now()");
    await rows("select private.hub_run_sales_queue_worker(10)");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(1);
    expect(await rows("select origin,created_by from hub_sales_distributions")).toEqual([
      { origin: "automatic", created_by: null },
    ]);
    await expect(db.exec("update hub_sales_distributions set origin='manual'")).rejects.toThrow();
  });
  it("fila específica precede geral e não captura empreendimento alheio", async () => {
    await addQueue(Q, null);
    await addQueue(Q2, 10);
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select queue_id from hub_sales_distributions"))[0].queue_id).toBe(Q2);
    await db.exec("update crm_leads set id_empreendimento=20");
    expect((await rows("select private.hub_queue_matches($1,$2) value", [Q2, OP]))[0].value).toBe(
      false,
    );
  });
  it("gatilho etapa OU qualificação; nenhum gatilho mantém manual", async () => {
    await addQueue(Q, 10, false);
    await addOp();
    expect((await rows("select private.hub_queue_matches($1,$2) value", [Q, OP]))[0].value).toBe(
      false,
    );
    await db.exec(
      "update hub_sales_queues set trigger_stage_ids='{10}';update crm_leads set qualificado=0",
    );
    expect((await rows("select private.hub_queue_matches($1,$2) value", [Q, OP]))[0].value).toBe(
      true,
    );
    await db.exec("update crm_leads set crm_stage_id=null");
    expect((await rows("select private.hub_queue_matches($1,$2) value", [Q, OP]))[0].value).toBe(
      false,
    );
  });
  it("fila fora do horário não oferece; abertura retoma", async () => {
    await addQueue();
    await addOp();
    await db.exec("update hub_sales_queues set schedule_enabled=true,weekdays='{}'");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(0);
    await db.exec(
      "update hub_sales_queues set schedule_enabled=false;update private.hub_sales_waiting set next_attempt_at=now()",
    );
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(1);
  });
  it("pausa individual preserva usuário e posição e pula novas ofertas", async () => {
    await addQueue();
    await rows("select private.hub_pause_queue_member($1,$2,true)", [Q, A]);
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select member_id from hub_sales_offers"))[0].member_id).toBe(B);
    expect((await rows("select active from crm_users where id=$1", [A]))[0].active).toBe(true);
    expect(
      (await rows("select position from hub_sales_queue_members where member_id=$1", [A]))[0]
        .position,
    ).toBe(1);
  });
  it("todos pausados aguardam e retomam quando um volta", async () => {
    await addQueue();
    await db.exec("update hub_sales_queue_members set paused=true");
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(0);
    await rows("select private.hub_pause_queue_member($1,$2,false)", [Q, A]);
    await db.exec("update private.hub_sales_waiting set next_attempt_at=now()");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select member_id from hub_sales_offers"))[0].member_id).toBe(A);
  });
  it("não distribui oportunidade já atribuída nem CRM desligado", async () => {
    await addQueue();
    await addOp();
    await db.exec("update hub_company_modules set crm=false");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(0);
    await db.query("update crm_opportunities set assigned_to=$1", [A]);
    await db.exec("update hub_company_modules set crm=true");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(0);
  });
  it("rodada esgotada espera 30 minutos antes de nova tentativa", async () => {
    await addQueue();
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    await db.exec("update hub_sales_offers set expires_at=now()-interval '1 second'");
    await rows("select private.hub_run_sales_queue_worker(10)");
    await db.exec(
      "update hub_sales_offers set expires_at=now()-interval '1 second' where status='pending'",
    );
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select status from hub_sales_distributions"))[0].status).toBe("exhausted");
    expect(
      (
        await rows(
          "select reason,next_attempt_at>now()+interval '29 minutes' delayed from private.hub_sales_waiting",
        )
      )[0],
    ).toMatchObject({ reason: "no_acceptance", delayed: true });
  });
  it("salva regras, rejeita outro tenant e request reutilizado", async () => {
    await save();
    expect((await rows("select development_id from hub_sales_queues"))[0].development_id).toBe(10);
    await save();
    expect((await rows("select * from hub_sales_queues")).length).toBe(1);
    await expect(save({ ...rules, priority: 5 })).rejects.toThrow("reutilizada");
    await expect(save({ ...rules, development_id: 20 })).rejects.toThrow("Empreendimento");
    await expect(save({ ...rules, trigger_stage_ids: [20] })).rejects.toThrow("etapas");
  });
  it("rejeita horário inválido e acesso do corretor", async () => {
    await expect(save({ ...rules, ends_at: "07:00" })).rejects.toThrow("horários");
    await db.query("select set_config('test.actor',$1,false)", [A]);
    await expect(save()).rejects.toThrow("Acesso");
    await expect(rows("select private.hub_sales_queue_overview(1)")).rejects.toThrow("Acesso");
  });
  it("agrega histórico sem truncar e isola empresa", async () => {
    await addQueue();
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    await db.exec(
      "update hub_sales_offers set status='accepted',resolved_at=created_at+interval '3 minutes'",
    );
    const summary = (await rows("select private.hub_sales_queue_overview(1) value"))[0].value;
    expect(summary.stats[0]).toMatchObject({ received: 1, accepted: 1, mean_minutes: 3 });
    await expect(rows("select private.hub_sales_queue_overview(2)")).rejects.toThrow("Acesso");
  });
  it("não concede execução de helpers a anon/authenticated", async () => {
    const grants = await rows(
      "select has_function_privilege('anon','public.hub_sales_queue_overview(bigint)','execute') a,has_function_privilege('authenticated','private.hub_route_sales_waiting(integer)','execute') b,has_function_privilege('authenticated','public.hub_sales_queue_overview(bigint)','execute') c",
    );
    expect(grants[0]).toEqual({ a: false, b: false, c: true });
  });
  it("cancelamento remove a espera e não redistribui automaticamente", async () => {
    await addQueue();
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    const id = (await rows("select id from hub_sales_distributions"))[0].id;
    await rows("select private.hub_advance_sales_distribution_locked($1,true)", [id]);
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from private.hub_sales_waiting")).length).toBe(0);
    expect((await rows("select * from hub_sales_distributions")).length).toBe(1);
  });
  it("oferta expira fora do horário sem enviar a próxima até a abertura", async () => {
    await addQueue();
    await addOp();
    await rows("select private.hub_run_sales_queue_worker(10)");
    await db.exec(
      "update hub_sales_queues set schedule_enabled=true,weekdays='{}';update hub_sales_offers set expires_at=now()-interval '1 second'",
    );
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(1);
    expect((await rows("select status from hub_sales_offers"))[0].status).toBe("expired");
    await db.exec("update hub_sales_queues set schedule_enabled=false");
    await rows("select private.hub_run_sales_queue_worker(10)");
    expect((await rows("select * from hub_sales_offers")).length).toBe(2);
  });
  it("edição preserva pausa e rejeita revisão antiga", async () => {
    const queue = (await save())[0];
    await rows("select private.hub_pause_queue_member($1,$2,true)", [queue.id, A]);
    const update = (revision: number) =>
      rows(
        "select * from private.hub_save_sales_queue_v2(1,$1,'Editada',10,$2::uuid[],true,$3,null,$4)",
        [queue.id, [A, B], revision, JSON.stringify(rules)],
      );
    await expect(update(1)).rejects.toThrow("Atualize");
    await update(2);
    expect(
      (
        await rows(
          "select paused from hub_sales_queue_members where queue_id=$1 and member_id=$2",
          [queue.id, A],
        )
      )[0].paused,
    ).toBe(true);
  });
  it("erro de uma oportunidade não impede a seguinte e desfaz a oferta parcial", async () => {
    await addQueue();
    await addOp();
    await db.exec(
      "insert into crm_opportunities values('30000000-0000-0000-0000-000000000002',1,1,'Outra oportunidade',null)",
    );
    await db.exec(`create function private.test_reject_offer() returns trigger language plpgsql as $$begin if new.opportunity_title='Oportunidade teste' then raise exception 'teste';end if;return new;end$$;
      create trigger test_reject before insert on hub_sales_offers for each row execute function private.test_reject_offer()`);
    try {
      await rows("select private.hub_run_sales_queue_worker(10)");
      expect(await rows("select opportunity_title from hub_sales_offers")).toEqual([
        { opportunity_title: "Outra oportunidade" },
      ]);
      expect(
        (
          await rows("select reason from private.hub_sales_waiting where opportunity_id=$1", [OP])
        )[0].reason,
      ).toBe("processing_error");
      expect((await rows("select * from hub_sales_distributions")).length).toBe(1);
    } finally {
      await db.exec(
        "drop trigger test_reject on hub_sales_offers;drop function private.test_reject_offer()",
      );
    }
  });
});
