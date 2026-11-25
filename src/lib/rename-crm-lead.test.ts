import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema private; create schema auth; create role anon; create role authenticated;
    create function auth.uid() returns text language sql as $$select 'user1'::text$$;
    create table crm_users(auth_user_id text, active boolean, role text, id_empresa bigint);
    create table crm_leads(id bigint primary key, id_empresa bigint, lead_id bigint, nome text);
    create table lead(id bigint primary key, id_empresa bigint, id_crm text, nome text);
    create table credentials(id_empresa bigint, default_crm text);
    create function private.hub_agent_crm_lead_ids() returns setof bigint language sql as $$select 10::bigint$$;
    create function private.hub_agent_operational_lead_ids() returns setof bigint language sql as $$select 110::bigint$$;
    insert into crm_users values ('user1',true,'manager',36);
    insert into crm_leads values(10,36,110,'Original'),(11,36,null,'Antigo'),(12,36,null,'Sem conversa'),(13,9,null,'Externo');
    insert into lead values(110,36,'external','Original'),(111,36,'11','Antigo'),(113,9,'13','Outro');
    insert into credentials values(36,'Hub'),(9,'Kommo');
  `);
  await db.exec(readFileSync(new URL("../../supabase/migrations/20261125183045_rename_crm_lead.sql", import.meta.url), "utf8"));
});
afterAll(() => db.close());

const rename = (company: number, contact: number, name: string) =>
  db.query("select public.hub_rename_crm_lead($1,$2,$3)", [company, contact, name]);

it("saves both names for explicit and legacy Hub links, and accepts a standalone contact", async () => {
  await rename(36, 10, "  Isadora  ");
  await rename(36, 11, "Nome atualizado");
  await rename(36, 12, "Sem vínculo");
  expect((await db.query("select c.nome, l.nome as conversa from crm_leads c join lead l on c.lead_id=l.id or (c.id_empresa=36 and l.id_crm=c.id::text) order by c.id")).rows)
    .toEqual([{nome:"Isadora", conversa:"Isadora"}, {nome:"Nome atualizado", conversa:"Nome atualizado"}]);
});
it("rejects invalid names and ambiguous links before changing either record", async () => {
  await expect(rename(36, 10, " ")).rejects.toThrow();
  await expect(rename(36, 10, "a".repeat(151))).rejects.toThrow();
  await db.exec("insert into lead values(112,36,'11','Outra conversa')");
  await expect(rename(36, 11, "Erro")).rejects.toThrow(/uma conversa/);
  expect((await db.query("select nome from crm_leads where id=11")).rows[0]).toEqual({nome:"Nome atualizado"});
});
it("enforces company and assigned-lead access and ignores external CRM id collisions", async () => {
  await expect(rename(9, 13, "Erro")).rejects.toThrow();
  await db.exec("update crm_users set role='agent'");
  await rename(36, 10, "Permitido");
  await expect(rename(36, 12, "Sem acesso")).rejects.toThrow();
  await db.exec("update crm_users set role='analyst'");
  await expect(rename(36, 10, "Apenas leitura")).rejects.toThrow();
  await db.exec("update crm_users set role='super_admin'");
  await rename(9, 13, "Contato externo");
  expect((await db.query("select nome from lead where id=113")).rows[0]).toEqual({nome:"Outro"});
});
