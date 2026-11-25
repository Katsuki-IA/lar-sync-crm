import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";

it("guards manual template reservations per company, lead and name across requests", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private; create role anon; create role authenticated; create role service_role;
      create table private.hub_conversation_deliveries(
        id uuid default gen_random_uuid(), claim_token uuid default gen_random_uuid(),
        id_empresa bigint, lead_id bigint, request_id text, request_body jsonb,
        state text default 'sending', receipt jsonb, completed_at timestamptz,
        created_at timestamptz default now(), unique(id_empresa,request_id));
    `);
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261125193013_manual_template_repeat_guard.sql", import.meta.url), "utf8"));
    const reserve = (request: string, name = "atendimento_3", lead = 1, company = 35) =>
      db.query(`insert into private.hub_conversation_deliveries(id_empresa,lead_id,request_id,request_body)
        values ($1,$2,$3,jsonb_build_object('action','send_template','templateName',$4::text))
        on conflict(id_empresa,request_id) do nothing`, [company,lead,request,name]);
    await reserve("first");
    await reserve("first");
    await expect(reserve("second")).rejects.toThrow(/aguardando confirmação/);
    await reserve("other-template","atendimento_2");
    await reserve("other-lead","atendimento_3",2);
    await reserve("other-company","atendimento_3",1,36);
    await db.exec("select public.hub_release_rejected_template(id,claim_token) from private.hub_conversation_deliveries where request_id='first'");
    await reserve("second");
    await db.exec(`update private.hub_conversation_deliveries set created_at=now()-interval '25 hours',
      state='accepted', receipt=jsonb_build_object('transport',jsonb_build_object('sent_at',now()-interval '23 hours'))
      where request_id='second'`);
    await expect(reserve("retry")).rejects.toThrow(/já foi enviado/);
    await db.exec("update private.hub_conversation_deliveries set state='completed' where request_id='second'");
    await db.exec("select public.hub_release_rejected_template(id,claim_token) from private.hub_conversation_deliveries where request_id='second'");
    await expect(reserve("retry")).rejects.toThrow(/já foi enviado/);
    await db.exec(`update private.hub_conversation_deliveries set receipt=jsonb_build_object('transport',jsonb_build_object('sent_at',now()-interval '24 hours')) where request_id='second'`);
    await reserve("retry");
  } finally { await db.close(); }
});
