import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
let db: PGlite;
const manager = "10000000-0000-0000-0000-000000000001";
const agent = "10000000-0000-0000-0000-000000000002";
const other = "10000000-0000-0000-0000-000000000003";
const own = "20000000-0000-0000-0000-000000000001";
const elsewhere = "20000000-0000-0000-0000-000000000002";
const query = async (sql: string, args: unknown[] = []) =>
  (
    await db.query<{ id: number; nome: string; revision: number; tags: { uses: number }[] }>(
      sql,
      args,
    )
  ).rows;
async function act(id: string, role = "authenticated") {
  await db.exec(`reset role;select set_config('test.actor','${id}',false);set role ${role};`);
}
async function create(name = "Investidor", company = 1) {
  return (
    await query(
      "select public.hub_save_commercial_tag($1,null,null,$2,'#C14F21','Compra para renda',true) id",
      [company, name],
    )
  )[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
create schema auth;create schema private;create role anon;create role authenticated;create role service_role bypassrls;
grant usage on schema public,private,auth to authenticated,anon,service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table empresa_dados(id bigint primary key);
create table crm_users(id uuid primary key,auth_user_id uuid,id_empresa bigint,active boolean,role text);
create table hub_company_modules(id_empresa bigint primary key,crm boolean);
create table crm_opportunities(id uuid primary key,id_empresa bigint,assigned_to uuid,unique(id,id_empresa));
create table crm_lead_tags(lead_id bigint,tag_id bigint);
grant select on crm_users,hub_company_modules,crm_opportunities to authenticated;
grant all on crm_lead_tags to authenticated,service_role;
create function private.crm_can_access_empresa(bigint) returns boolean language sql stable security definer as $$select exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and (role='super_admin' or id_empresa=$1))$$;
create function private.hub_sales_module_enabled(bigint) returns boolean language sql stable security definer as $$select exists(select 1 from public.hub_company_modules where id_empresa=$1 and crm)$$;
create function private.hub_sales_manager_native(bigint) returns boolean language sql stable security definer as $$select exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and (role='super_admin' or (id_empresa=$1 and role in ('manager','gestor'))))$$;
create function private.hub_opportunity_visible(bigint,uuid) returns boolean language sql stable security definer as $$select auth.uid() is not null and private.crm_can_access_empresa($1) and private.hub_sales_module_enabled($1) and exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and (role='super_admin' or (id_empresa=$1 and (role in ('manager','gestor') or (role in ('agent','corretor') and id=$2)))))$$;
alter table crm_opportunities enable row level security;
create policy opportunity_read on crm_opportunities for select to authenticated using(private.hub_opportunity_visible(id_empresa,assigned_to));
`);
  await db.exec(
    readFileSync(new URL("../../docs/commercial-tags-candidate.sql", import.meta.url), "utf8"),
  );
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role;truncate crm_opportunity_tags,crm_commercial_tags,crm_users,crm_opportunities,hub_company_modules,empresa_dados cascade;
insert into empresa_dados values(1),(2);insert into hub_company_modules values(1,true),(2,true);
insert into crm_users values('${manager}','${manager}',1,true,'manager'),('${agent}','${agent}',1,true,'agent'),('${other}','${other}',2,true,'agent');
insert into crm_opportunities values('${own}',1,'${agent}'),('${elsewhere}',2,'${other}');`);
  await act(manager);
});
it("gestor cadastra e edita apenas tags da própria empresa, com revisão", async () => {
  const id = await create();
  await query(
    "select hub_save_commercial_tag(1,$1,0,'Financiamento','#2563EB','Simular crédito',true)",
    [id],
  );
  expect((await query("select nome,revision from crm_commercial_tags"))[0]).toEqual({
    nome: "Financiamento",
    revision: 1,
  });
  await expect(
    query("select hub_save_commercial_tag(1,$1,0,'Outra','#2563EB','',true)", [id]),
  ).rejects.toThrow("Atualize");
  await expect(create("Outra", 2)).rejects.toThrow("Acesso restrito");
});
it("corretor pode aplicar e remover na própria oportunidade, sem duplicar", async () => {
  const id = await create();
  await act(agent);
  for (let i = 0; i < 2; i++) await query("select hub_set_opportunity_tag($1,$2,true)", [own, id]);
  expect((await query("select * from crm_opportunity_tags")).length).toBe(1);
  await query("select hub_set_opportunity_tag($1,$2,false)", [own, id]);
  expect(await query("select * from crm_opportunity_tags")).toEqual([]);
  await expect(create()).rejects.toThrow("gestor");
});
it("não permite aplicar tags de outra empresa nem ler associações alheias", async () => {
  const id = await create();
  await act(agent);
  await expect(
    query("select hub_set_opportunity_tag($1,$2,true)", [elsewhere, id]),
  ).rejects.toThrow("indisponível");
  await query("select hub_set_opportunity_tag($1,$2,true)", [own, id]);
  await act(other);
  expect(await query("select * from crm_commercial_tags")).toEqual([]);
  expect(await query("select * from crm_opportunity_tags")).toEqual([]);
  await act(manager);
  await db.exec("reset role;update crm_users set role='super_admin' where id='" + manager + "'");
  await act(manager);
  await expect(
    query("select hub_set_opportunity_tag($1,$2,true)", [elsewhere, id]),
  ).rejects.toThrow("Tag indisponível");
});
it("arquivamento preserva marcas e permite remover, mas não novas aplicações", async () => {
  const id = await create();
  await query("select hub_set_opportunity_tag($1,$2,true)", [own, id]);
  await query("select hub_save_commercial_tag(1,$1,0,'Investidor','#C14F21','',false)", [id]);
  await act(agent);
  expect((await query("select * from crm_opportunity_tags")).length).toBe(1);
  await expect(query("select hub_set_opportunity_tag($1,$2,true)", [own, id])).rejects.toThrow(
    "Tag indisponível",
  );
  await query("select hub_set_opportunity_tag($1,$2,false)", [own, id]);
});
it("bloqueia usuário inativo, analista e CRM desligado", async () => {
  const id = await create();
  for (const change of ["active=false", "active=true,role='analyst'"]) {
    await db.exec(`reset role;update crm_users set ${change} where id='${agent}'`);
    await act(agent);
    await expect(query("select hub_set_opportunity_tag($1,$2,true)", [own, id])).rejects.toThrow(
      "indisponível",
    );
    expect(await query("select * from crm_commercial_tags")).toEqual([]);
  }
  await db.exec("reset role;update hub_company_modules set crm=false");
  await act(manager);
  await expect(create()).rejects.toThrow("gestor");
});
it("revalida dono após transferência de oportunidade", async () => {
  const id = await create();
  await db.exec(`reset role;update crm_opportunities set assigned_to=null where id='${own}'`);
  await act(agent);
  await expect(query("select hub_set_opportunity_tag($1,$2,true)", [own, id])).rejects.toThrow(
    "indisponível",
  );
});
it("impede escrita direta e acesso anônimo, preservando escrita da automação IA", async () => {
  const id = await create();
  await expect(
    query("insert into crm_commercial_tags(id_empresa,nome,cor) values(1,'Bypass','#ffffff')"),
  ).rejects.toThrow("permission denied");
  await expect(
    query("insert into crm_opportunity_tags values($1,$2,1,now())", [own, id]),
  ).rejects.toThrow("permission denied");
  await expect(query("insert into crm_lead_tags values(1,1)")).rejects.toThrow("permission denied");
  await act("", "anon");
  await expect(create()).rejects.toThrow("permission denied");
  await expect(query("select * from crm_commercial_tags")).rejects.toThrow("permission denied");
  await act("", "service_role");
  await query("insert into crm_lead_tags values(1,1)");
});
it("valida dados e unicidade por empresa; conta apenas associações visíveis", async () => {
  const id = await create();
  await expect(create(" investidor ")).rejects.toThrow("duplicate key");
  await expect(
    query("select hub_save_commercial_tag(1,null,null,'X','red','',true)"),
  ).rejects.toThrow("Confira");
  await query("select hub_set_opportunity_tag($1,$2,true)", [own, id]);
  expect((await query("select hub_commercial_tags(1) tags"))[0].tags[0].uses).toBe(1);
  await act(other);
  expect((await query("select hub_commercial_tags(1) tags"))[0].tags).toEqual([]);
});
