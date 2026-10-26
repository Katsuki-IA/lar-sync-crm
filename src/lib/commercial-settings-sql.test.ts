import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
let db: PGlite;
const fixture = `
create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.crm_users(id uuid primary key,auth_user_id uuid,id_empresa bigint,nome text,active boolean,role text);
create table public.hub_company_modules(id_empresa bigint primary key,crm boolean);
create table public.empreendimento(id bigint primary key,id_empresa bigint,nome text);
create table public.crm_stages(id bigint primary key,id_empresa bigint,module text,ativo boolean,nome text,id_funnel bigint,ordem integer default 1);
create table public.crm_funnels(id bigint primary key,id_empresa bigint,module text,ativo boolean);
create table public.crm_leads(id bigint primary key,id_empresa bigint,nome text,id_empreendimento bigint,qualificado smallint,crm_stage_id bigint);
create table public.crm_opportunities(id uuid primary key default gen_random_uuid(),id_empresa bigint,lead_id bigint,title text,assigned_to uuid,funnel_id bigint default 7,stage_id bigint default 30,request_id uuid default gen_random_uuid(),created_by uuid not null default '20000000-0000-0000-0000-000000000003',unique(id_empresa,lead_id,funnel_id));
create table public.crm_opportunity_events(opportunity_id uuid,id_empresa bigint,actor_id uuid,kind text,to_stage_id bigint);
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
const actor = "20000000-0000-0000-0000-000000000003";
const sql = (name: string) => readFileSync(new URL("../../docs/" + name, import.meta.url), "utf8");
const query = async (s: string, p: any[] = []) => (await db.query<any>(s, p)).rows;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(sql("distribution-v2-original-functions.sql"));
  await db.exec(sql("distribution-v2-candidate.sql"));
  await db.exec(sql("distribution-v3-intake.sql"));
  await db.exec(`create sequence test_funnels start 100;create sequence test_stages start 100;
alter table crm_funnels alter column id set default nextval('test_funnels');alter table crm_stages alter column id set default nextval('test_stages');
create table empresa_dados(id bigint primary key,default_crm text);
create table crm_tags(id bigint primary key,id_empresa bigint,nome text);
create table crm_lead_tags(lead_id bigint,tag_id bigint);
alter table crm_funnels add column nome text,add column ordem integer default 1,add column hub_revision integer default 0;
alter table crm_stages add column cor text,add column hub_revision integer default 0;
alter table crm_opportunities add column version integer default 0,add column updated_at timestamptz default now();
alter table crm_opportunity_events add column from_stage_id bigint;
create table private.hub_configuration_audit(id_empresa bigint,actor_id uuid,kind text,record_id bigint,before_data jsonb,after_data jsonb);`);
  await db.exec(sql("commercial-settings-candidate.sql"));
}, 30000);
afterAll(async () => await db.close());
beforeEach(async () => {
  await db.exec(`truncate empresa_dados,crm_users,hub_company_modules,crm_funnels,crm_stages,crm_leads,crm_opportunities,crm_opportunity_events,private.hub_configuration_audit,private.hub_queue_intake cascade;
insert into empresa_dados values(1,'katsuki'),(2,'katsuki');insert into hub_company_modules values(1,true),(2,true);
insert into crm_users values('${actor}','${actor}',1,'Gestor',true,'gestor');select set_config('test.actor','${actor}',false);
insert into crm_funnels(id,id_empresa,module,ativo,nome) values(7,1,'crm',true,'Vendas'),(8,2,'crm',true,'Outra');
insert into crm_stages(id,id_empresa,module,ativo,nome,id_funnel) values(10,1,'ia',true,'Qualificado',6),(30,1,'crm',true,'Entrada',7),(31,1,'crm',true,'Contato',7),(32,2,'crm',true,'Outra',8);
insert into crm_leads values(1,1,'Teste',null,1,10);`);
});
const mapping = {
  unqualified: { funnel_id: 7, stage_id: 30 },
  qualified: { funnel_id: 7, stage_id: 31 },
};
async function enable(dest = mapping) {
  await db.exec("update crm_users set role='super_admin'");
  await query("select public.hub_save_internal_crm(1,0,true,$1)", [JSON.stringify(dest)]);
}
it("gestor edita somente a empresa e etapas comerciais, com revisão", async () => {
  const data = JSON.stringify({
    nome: "Novo nome",
    ordem: 1,
    ativo: true,
    id_funnel: 7,
    cor: "#abcdef",
  });
  await query("select public.hub_save_commercial_definition(1,'stage',30,0,$1)", [data]);
  expect((await query("select nome from crm_stages where id=30"))[0].nome).toBe("Novo nome");
  await expect(
    query("select public.hub_save_commercial_definition(1,'stage',30,0,$1)", [data]),
  ).rejects.toThrow("Atualize");
  await expect(
    query("select public.hub_save_commercial_definition(1,'stage',10,0,$1)", [data]),
  ).rejects.toThrow("indisponível");
  await expect(query("select public.hub_commercial_config(2)")).rejects.toThrow("restrito");
  await expect(
    query("select public.hub_save_internal_crm(1,0,true,$1)", [JSON.stringify(mapping)]),
  ).rejects.toThrow("super admin");
});
it("destino recusa etapa de outra empresa", async () => {
  await expect(enable({ unqualified: { funnel_id: 8, stage_id: 32 } } as any)).rejects.toThrow(
    "empresa",
  );
});
it("desligado não intercepta; ligado cria na etapa mapeada sem duplicar ou reatribuir", async () => {
  expect((await query("select public.hub_dispatch_internal_crm(1,1) r"))[0].r.handled).toBe(false);
  await enable();
  await query("select public.hub_dispatch_internal_crm(1,1)");
  expect((await query("select stage_id from crm_opportunities"))[0].stage_id).toBe(31);
  await query("update crm_opportunities set assigned_to=$1,stage_id=30", [actor]);
  await query("select public.hub_dispatch_internal_crm(1,1)");
  expect(await query("select stage_id,assigned_to from crm_opportunities")).toEqual([
    { stage_id: 30, assigned_to: actor },
  ]);
  expect((await query("select * from crm_opportunity_events")).length).toBe(1);
});
it("desativar etapa em uso exige substituta e move dados e regras na mesma transação", async () => {
  await enable();
  await query("select public.hub_dispatch_internal_crm(1,1)");
  const data = { nome: "Contato", ordem: 2, ativo: false, id_funnel: 7, cor: "#abcdef" };
  await expect(
    query("select public.hub_save_commercial_definition(1,'stage',31,0,$1)", [
      JSON.stringify(data),
    ]),
  ).rejects.toThrow("substituta");
  await query("select public.hub_save_commercial_definition(1,'stage',31,0,$1)", [
    JSON.stringify({ ...data, replacement_id: 30 }),
  ]);
  expect((await query("select stage_id from crm_opportunities"))[0].stage_id).toBe(30);
  expect(
    (await query("select destinations from private.hub_internal_crm_settings"))[0].destinations
      .qualified.stage_id,
  ).toBe(30);
  await expect(
    query("select public.hub_save_commercial_definition(1,'stage',30,0,$1)", [
      JSON.stringify(data),
    ]),
  ).rejects.toThrow("ao menos uma");
});
it("RPC de dispatch não é executável pelo navegador", async () => {
  expect(
    (
      await query(
        "select has_function_privilege('authenticated','public.hub_dispatch_internal_crm(bigint,bigint,text)','execute') allowed",
      )
    )[0].allowed,
  ).toBe(false);
  expect(
    (
      await query(
        "select has_function_privilege('service_role','public.hub_dispatch_internal_crm(bigint,bigint,text)','execute') allowed",
      )
    )[0].allowed,
  ).toBe(true);
});

it("cria funil e etapas; desativa funil sem uso preservando os registros", async () => {
  await query("select public.hub_save_commercial_definition(1,'funnel',null,null,$1)", [
    JSON.stringify({ nome: "Locação", ordem: 2, ativo: true }),
  ]);
  const f = (await query("select id from crm_funnels where nome='Locação'"))[0].id;
  await query("select public.hub_save_commercial_definition(1,'stage',null,null,$1)", [
    JSON.stringify({ nome: "Entrada", ordem: 1, ativo: true, id_funnel: f, cor: "#123456" }),
  ]);
  await query("select public.hub_save_commercial_definition(1,'funnel',$1,0,$2)", [
    f,
    JSON.stringify({ nome: "Locação", ordem: 2, ativo: false }),
  ]);
  expect((await query("select ativo from crm_stages where id_funnel=$1", [f]))[0].ativo).toBe(
    false,
  );
});
it("usa entrada padrão para situação sem mapeamento próprio e recusa lead de outra empresa", async () => {
  await enable();
  const result = (
    await query("select public.hub_dispatch_internal_crm(1,1,'without_whatsapp') r")
  )[0].r;
  expect(result.situation).toBe("without_whatsapp");
  expect((await query("select stage_id from crm_opportunities"))[0].stage_id).toBe(30);
  await expect(query("select public.hub_dispatch_internal_crm(1,999)")).rejects.toThrow(
    "indisponível",
  );
});
it("intake não antecipa a oportunidade quando o envio interno está ativo", async () => {
  await enable();
  expect((await query("select private.hub_process_queue_intake(10) n"))[0].n).toBe(0);
  expect(await query("select id from crm_opportunities")).toEqual([]);
});
