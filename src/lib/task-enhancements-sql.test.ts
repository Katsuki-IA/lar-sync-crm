import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
let db: PGlite;
const manager = "10000000-0000-0000-0000-000000000001";
const agent = "10000000-0000-0000-0000-000000000002";
const other = "10000000-0000-0000-0000-000000000003";
const op = "20000000-0000-0000-0000-000000000001";
type Task = {
  id: string;
  revision: number;
  prazo: string;
  assigned_to: string;
  status: string;
  tipo: string;
  reminder_minutes: number | null;
};
type Job = { id: string; lease: string; phone: string; body: string };
const file = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8");
const rows = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  (await db.query<T>(sql, args)).rows;
const act = async (id = manager, role = "authenticated") =>
  db.exec(`reset role;select set_config('test.actor','${id}',false);set role ${role};`);
const root = () => db.exec("reset role");
async function save(
  task?: Task,
  patch: Partial<Task> & {
    type?: string;
    reminder?: number | null;
    due?: string;
    assignee?: string;
    request?: string;
  } = {},
) {
  const [r] = await rows<{ task: Task }>(
    "select public.hub_save_task_v2(1,$1,1,$2,'Ligar para cliente','Contexto','alta',$3,$4,$5,$6,$7,$8,$9) task",
    [
      task?.id ?? null,
      op,
      patch.due ?? task?.prazo ?? new Date(Date.now() + 600000).toISOString(),
      patch.assignee ?? task?.assigned_to ?? agent,
      patch.status ?? task?.status ?? "pendente",
      patch.revision ?? task?.revision ?? null,
      patch.request ?? crypto.randomUUID(),
      patch.type ?? task?.tipo ?? "ligacao",
      patch.reminder === undefined ? (task?.reminder_minutes ?? 15) : patch.reminder,
    ],
  );
  return r.task;
}
async function claim() {
  await root();
  return (
    await rows<{ job: Job | null }>("select private.hub_claim_whatsapp('test-instance') job")
  )[0].job;
}
async function job() {
  await root();
  return (await rows("select * from private.hub_task_reminders"))[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;create schema private;create schema vault;create schema net;
 create role authenticated;create role anon;create role service_role bypassrls;
 grant usage on schema public,auth,private to authenticated,anon,service_role;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create type crm_task_priority as enum('baixa','normal','alta');create type crm_task_status as enum('pendente','em_andamento','vencida','concluida','cancelada');
 create table empresa_dados(id bigint primary key);
 create table crm_users(id uuid primary key,auth_user_id uuid,id_empresa bigint,nome text,active boolean,role text);
 create table hub_company_modules(id_empresa bigint primary key,crm boolean);
 create table crm_leads(id bigint primary key,id_empresa bigint,nome text,crm_assigned_to uuid);
 create table crm_opportunities(id uuid primary key,id_empresa bigint,lead_id bigint,assigned_to uuid);
 create table crm_lead_tasks(id uuid primary key default gen_random_uuid(),id_empresa bigint,lead_id bigint,opportunity_id uuid,titulo text,descricao text,prioridade crm_task_priority default 'normal',status crm_task_status default 'pendente',prazo timestamptz,assigned_to uuid,created_by uuid,revision integer default 1,completed_at timestamptz,updated_at timestamptz default now(),request_id uuid,creation_payload jsonb,source_offer_id uuid,initial_due_at timestamptz,unique(id_empresa,request_id));
 create table hub_task_events(task_id uuid,id_empresa bigint,actor_id uuid,actor_name text,kind text,before_data jsonb,after_data jsonb);
 create table hub_whatsapp_channels(id_empresa bigint primary key,instance text,enabled boolean,auto_send boolean,inbound_verified_at timestamptz,last_dispatch_at timestamptz);
 create table private.hub_whatsapp_recipients(id_empresa bigint,member_id uuid,phone text,enabled boolean);
 create table private.hub_whatsapp_transport(id_empresa bigint,worker_secret uuid,api_key_secret uuid);
 create table private.hub_secretary_endpoints(singleton boolean,base_url text);
 create table vault.decrypted_secrets(id uuid,decrypted_secret text);
 create table private.hub_whatsapp_dispatch_runs(id_empresa bigint,request_id bigint,created_at timestamptz default now());
 create table hub_whatsapp_outbox(id uuid,notice_id uuid,id_empresa bigint,member_id uuid,status text,attempts integer,available_at timestamptz,lease uuid,claimed_at timestamptz,provider_id text,reason text,updated_at timestamptz);
 create table hub_secretary_notices(id uuid,offer_id uuid,body text);
 create table hub_sales_offers(id uuid,distribution_id uuid,status text,expires_at timestamptz);
 create table hub_sales_distributions(id uuid,queue_id uuid,opportunity_id uuid,status text);
 create table hub_sales_queues(id uuid,active boolean);
 create function private.hub_secretary_runtime(text,text) returns jsonb language sql as $$select case when $1='worker' and $2='test-token' then '{"company":1,"instance":"test-instance"}'::jsonb when $1='worker' and $2='foreign-token' then '{"company":2,"instance":"elsewhere"}'::jsonb else null end$$;
 create function private.crm_can_access_empresa(bigint) returns boolean language sql security definer as $$select exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and (role='super_admin' or id_empresa=$1))$$;
 create function private.hub_sales_module_enabled(bigint) returns boolean language sql security definer as $$select exists(select 1 from public.hub_company_modules where id_empresa=$1 and crm)$$;
 create function private.hub_task_visible(bigint,bigint,uuid,uuid) returns boolean language sql security definer as $$select private.crm_can_access_empresa($1) and private.hub_sales_module_enabled($1) and exists(select 1 from public.crm_users u where u.auth_user_id=auth.uid() and u.active and (u.role='super_admin' or (u.id_empresa=$1 and (u.role in ('manager','gestor') or (u.role in ('agent','corretor') and u.id=$4 and exists(select 1 from public.crm_opportunities o where o.id=$3 and o.lead_id=$2 and o.id_empresa=$1 and o.assigned_to=u.id))))))$$;
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
 grant select on crm_users,hub_company_modules,crm_leads,crm_opportunities to authenticated;
 grant all on crm_lead_tasks to authenticated;
 alter table crm_lead_tasks enable row level security;
 create policy visible_tasks on crm_lead_tasks to authenticated using(private.hub_task_visible(id_empresa,lead_id,opportunity_id,assigned_to)) with check(private.hub_task_visible(id_empresa,lead_id,opportunity_id,assigned_to));
 `);
  await db.exec(file("task-backend-baseline.sql"));
  await db.exec(
    "create trigger guard_task before insert or update or delete on crm_lead_tasks for each row execute function private.hub_guard_task_direct_write();",
  );
  await db.exec(file("task-enhancements-candidate.sql"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await root();
  await db.exec(`truncate crm_lead_tasks,crm_users,empresa_dados,crm_leads,crm_opportunities,hub_company_modules,hub_task_events,hub_whatsapp_channels,private.hub_whatsapp_recipients,private.hub_whatsapp_transport,private.hub_secretary_endpoints,vault.decrypted_secrets,private.hub_whatsapp_dispatch_runs cascade;
 insert into empresa_dados values(1),(2);insert into hub_company_modules values(1,true),(2,true);
 insert into crm_users values('${manager}','${manager}',1,'Gestor',true,'manager'),('${agent}','${agent}',1,'Corretor',true,'agent'),('${other}','${other}',2,'Outro',true,'agent');
 insert into crm_leads values(1,1,'Lead teste','${agent}');insert into crm_opportunities values('${op}',1,1,'${agent}');
 insert into hub_whatsapp_channels values(1,'test-instance',true,true,now(),null);
 insert into private.hub_whatsapp_recipients values(1,'${agent}','5511999999999',true),(1,'${manager}','5511888888888',true);
 insert into private.hub_whatsapp_transport values(1,'${manager}','${agent}');insert into vault.decrypted_secrets values('${manager}','fake-worker-secret');
 insert into private.hub_secretary_endpoints values(true,'https://example.invalid/functions/v1');`);
  await act();
});
it("cria tipo/lembrete de forma idempotente e mantém histórico", async () => {
  const request = crypto.randomUUID();
  const due = new Date(Date.now() + 600000).toISOString();
  const t = await save(undefined, { request, due });
  expect((await save(undefined, { request, due })).id).toBe(t.id);
  await expect(save(undefined, { request, due, type: "visita" })).rejects.toThrow("Solicitação");
  expect(t.tipo).toBe("ligacao");
  expect((await job()).status).toBe("pending");
  expect((await rows("select * from hub_task_events")).length).toBe(1);
});
it("aguarda a antecedência e só entrega uma vez", async () => {
  await save(undefined, { due: new Date(Date.now() + 3600000).toISOString() });
  expect(await claim()).toBeNull();
  await db.exec("update private.hub_task_reminders set available_at=now()-interval '1 minute'");
  const j = await claim();
  expect(j?.body).toContain("Lead teste");
  expect(await claim()).toBeNull();
  await rows("select private.hub_finish_task_reminder($1,$2,'sent','provider-id')", [
    j!.id,
    j!.lease,
  ]);
  expect((await job()).status).toBe("sent");
  expect(await claim()).toBeNull();
});
it("reagenda horário e destinatário, cancela ao concluir", async () => {
  let t = await save();
  t = await save(t, { due: new Date(Date.now() + 7200000).toISOString(), assignee: manager });
  const j = await job();
  expect(j.member_id).toBe(manager);
  expect(new Date(j.due_at as string).getTime()).toBe(new Date(t.prazo).getTime());
  await act();
  await save(t, { status: "concluida" });
  expect((await job()).status).toBe("cancelled");
  expect(await claim()).toBeNull();
});
it("cancela ao desligar lembrete e ao cancelar tarefa", async () => {
  let t = await save();
  t = await save(t, { reminder: null });
  expect((await job()).status).toBe("cancelled");
  await act();
  t = await save(t, { reminder: 15 });
  t = await save(t, { status: "cancelada" });
  expect((await job()).status).toBe("cancelled");
});
it("não envia para antigo responsável após transferência da oportunidade", async () => {
  await save();
  await root();
  await db.exec(`update crm_opportunities set assigned_to='${manager}'`);
  expect(await claim()).toBeNull();
  expect((await job()).status).toBe("cancelled");
});
it("revalida canal, módulo, destinatário e usuário no envio", async () => {
  await save();
  await root();
  await db.exec("update hub_whatsapp_channels set auto_send=false");
  expect(await claim()).toBeNull();
  expect((await job()).reason).toBe("task_or_recipient_unavailable");
});
it("bloqueia criação sem configuração, campos inválidos e prazo vencido", async () => {
  await expect(save(undefined, { type: "fake" })).rejects.toThrow("Tipo");
  await expect(save(undefined, { reminder: 2 })).rejects.toThrow("antecedência");
  await expect(
    save(undefined, { due: new Date(Date.now() - 10000).toISOString() }),
  ).rejects.toThrow("futuro");
  await root();
  await db.exec("delete from private.hub_secretary_endpoints");
  await act();
  await expect(save()).rejects.toThrow("Configure");
  expect((await save(undefined, { reminder: null })).reminder_minutes).toBeNull();
});
it("não duplica envio após interrupção e só repete rate-limit com espera", async () => {
  await save();
  const j = await claim();
  await rows("select private.hub_finish_task_reminder($1,$2,'rate_limited',null)", [
    j!.id,
    j!.lease,
  ]);
  expect(await claim()).toBeNull();
  await db.exec("update private.hub_task_reminders set available_at=now()-interval '1 second'");
  expect(await claim()).not.toBeNull();
  await db.exec("update private.hub_task_reminders set claimed_at=now()-interval '3 minutes'");
  expect(await claim()).toBeNull();
  expect((await job()).status).toBe("uncertain");
});
it("protege tarefa durante envio e rejeita confirmação de lease ou empresa errados", async () => {
  const t = await save();
  const j = await claim();
  await act();
  await expect(save(t, { status: "concluida" })).rejects.toThrow("em envio");
  await root();
  await rows("select private.hub_finish_task_reminder($1,$2,'sent','provider')", [
    j!.id,
    crypto.randomUUID(),
  ]);
  expect((await job()).status).toBe("sending");
  await expect(
    rows("select private.hub_secretary_call('worker','foreign-token','finish',$1)", [
      JSON.stringify({ p_id: j!.id, p_lease: j!.lease, p_status: "sent", p_provider_id: "x" }),
    ]),
  ).rejects.toThrow("Unavailable");
  await rows("select private.hub_secretary_call('worker','test-token','finish',$1)", [
    JSON.stringify({ p_id: j!.id, p_lease: j!.lease, p_status: "sent", p_provider_id: "x" }),
  ]);
  expect((await job()).status).toBe("sent");
});
it("corretor só gerencia suas tarefas; escrita direta e outbox são protegidos", async () => {
  await act(agent);
  const t = await save();
  await expect(save(t, { assignee: manager })).rejects.toThrow("próprias");
  await expect(
    rows("update crm_lead_tasks set reminder_minutes=5 where id=$1", [t.id]),
  ).rejects.toThrow("API");
  await expect(rows("select * from private.hub_task_reminders")).rejects.toThrow(
    "permission denied",
  );
  await act(other);
  await expect(save(t)).rejects.toThrow("Acesso");
  expect(
    (await rows<{ value: unknown[] }>("select hub_task_reminder_options(1) value"))[0].value,
  ).toEqual([]);
  await act(agent, "anon");
  await expect(save()).rejects.toThrow("permission denied");
});
it("não reenvia lembrete entregue ao editar só texto/tipo", async () => {
  const t = await save();
  const j = await claim();
  await rows("select private.hub_finish_task_reminder($1,$2,'sent','ok')", [j!.id, j!.lease]);
  await act();
  await save(t, { type: "visita" });
  expect((await job()).status).toBe("sent");
});
it("ordena prioridade antes da paginação e agenda somente empresas elegíveis", async () => {
  await save();
  await root();
  expect(
    (await rows<{ n: number }>("select private.hub_dispatch_due_task_reminders() n"))[0].n,
  ).toBe(1);
  expect((await rows("select * from private.hub_whatsapp_dispatch_runs")).length).toBe(1);
  expect(
    (
      await rows<{ priority_rank: number }>(
        "select priority_rank from crm_lead_tasks order by priority_rank,prazo,id",
      )
    )[0].priority_rank,
  ).toBe(0);
});
it("preserva o envio e confirmação de ofertas da fila", async () => {
  await root();
  await db.exec(`update crm_opportunities set assigned_to=null;
    insert into hub_sales_queues values('${op}',true);
    insert into hub_sales_distributions values('${op}','${op}','${op}','pending');
    insert into hub_sales_offers values('${op}','${op}','pending',now()+interval '1 hour');
    insert into hub_secretary_notices values('${op}','${op}','Oferta de teste');
    insert into hub_whatsapp_outbox(id,notice_id,id_empresa,member_id,status,attempts,available_at) values('${op}','${op}',1,'${agent}','pending',0,now());`);
  const j = await claim();
  expect(j?.body).toBe("Oferta de teste");
  await rows("select private.hub_secretary_call('worker','test-token','finish',$1)", [
    JSON.stringify({
      p_id: j!.id,
      p_lease: j!.lease,
      p_status: "sent",
      p_provider_id: "offer-provider-id",
    }),
  ]);
  expect(
    (await rows<{ status: string }>("select status from hub_whatsapp_outbox where id=$1", [op]))[0]
      .status,
  ).toBe("sent");
  await db.exec(
    "truncate hub_whatsapp_outbox,hub_secretary_notices,hub_sales_offers,hub_sales_distributions,hub_sales_queues",
  );
});
