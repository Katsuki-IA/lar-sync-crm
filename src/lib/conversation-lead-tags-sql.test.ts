import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private; create schema auth; create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
 create function public.crm_current_role() returns text language sql as $$select current_setting('test.role',true)$$;
 create function private.hub_native_conversation_id(bigint,bigint) returns bigint language sql as $$select 42::bigint$$;
 create table crm_leads(id bigint primary key,id_empresa bigint,lead_id bigint);
 create table lead(id bigint,id_empresa bigint,id_crm text);
 create table credentials(id_empresa bigint,default_crm text);
 create table crm_tags(id bigserial primary key,id_empresa bigint,nome text);
 create unique index names on crm_tags(id_empresa,lower(btrim(nome)));
 create table crm_lead_tags(lead_id bigint,tag_id bigint,primary key(lead_id,tag_id));
 create table private.hub_conversation_deliveries(lead_id bigint,id_empresa bigint,state text,receipt jsonb);
 insert into crm_leads values(100,36,42),(101,9,null); insert into lead values(42,36,'100'),(51,9,'101');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261125140842_conversation_lead_template_tags.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
afterAll(async () => db.close());
afterEach(async () =>
  db.exec("truncate crm_tags,crm_lead_tags,private.hub_conversation_deliveries,credentials"),
);
async function send(lead: number, company: number, type: string, finish = true) {
  await db.query("insert into private.hub_conversation_deliveries values($1,$2,'accepted',$3)", [
    lead,
    company,
    JSON.stringify({ transport: { type, template_name: "template_atendimento_1" } }),
  ]);
  if (finish)
    await db.exec(
      "update private.hub_conversation_deliveries set state='completed' where state='accepted'",
    );
}
it("tags completed templates once and reuses the existing company tag", async () => {
  await db.exec(
    "insert into crm_tags(id_empresa,nome) values (36,'template_atendimento_1'),(9,'template_atendimento_1')",
  );
  await send(42, 36, "template");
  await send(42, 36, "template");
  expect(
    (
      await db.query(
        "select l.lead_id,t.id_empresa from crm_lead_tags l join crm_tags t on t.id=l.tag_id",
      )
    ).rows,
  ).toEqual([{ lead_id: 100, id_empresa: 36 }]);
});
it("ignores texts and unfinalized attempts", async () => {
  await send(42, 36, "text");
  await send(42, 36, "template", false);
  expect((await db.query("select * from crm_tags")).rows).toEqual([]);
});
it("only uses the numeric fallback for a Hub CRM", async () => {
  await send(51, 9, "template");
  expect((await db.query("select * from crm_tags")).rows).toEqual([]);
  await db.exec("insert into credentials values(9,'Hub')");
  await send(51, 9, "template");
  expect((await db.query("select lead_id from crm_lead_tags")).rows).toEqual([{ lead_id: 101 }]);
});
it("checks permission, conversation identity and company on manual assignment", async () => {
  const add = "select public.hub_add_conversation_lead_tag(36,42,100,null,'Feira')";
  await db.exec("set test.role='agent'");
  await expect(db.exec(add)).rejects.toThrow();
  await db.exec("set test.role='super_admin'");
  await expect(db.exec(add.replace("36,42", "36,51"))).rejects.toThrow();
  await db.exec(add);
  await db.exec(add);
  await db.exec("insert into crm_tags(id_empresa,nome) values(9,'Outra empresa')");
  await expect(
    db.exec(
      "select public.hub_add_conversation_lead_tag(36,42,100,(select id from crm_tags where id_empresa=9),null)",
    ),
  ).rejects.toThrow();
  expect((await db.query("select lead_id from crm_lead_tags")).rows).toEqual([{ lead_id: 100 }]);
});
