import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

// Real SQL in an isolated database. External send/attendance integrations are stubs;
// eligibility, authorization, generation, scheduling, audit and replay run unchanged.
const sql = readFileSync(resolve("docs/prospect-resume-followups.sql"), "utf8").split("-- Only a new reply")[0];
let db: PGlite;
const actor = "00000000-0000-0000-0000-000000000001";
const contact = "00000000-0000-0000-0000-000000000002";
const req = "00000000-0000-0000-0000-000000000003";
const fixture = `
create schema private; create schema auth; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.crm_users(id uuid primary key,auth_user_id uuid,active boolean,role text,id_empresa bigint);
create table public.lead(id bigint primary key,id_empresa bigint,wa_conversation_assigned_to uuid,atendimento_humano boolean);
create table public.hub_company_modules(id_empresa bigint,crm boolean);
create table public.crm_lead_activities(lead_id bigint,crm_user_id uuid,tipo text,descricao text,metadata jsonb);
create table private.kp_contacts(id uuid primary key,legacy_lead_id bigint,crm_lead_id bigint,id_empresa bigint,status text,generation int,first_sent_at timestamptz,last_sent_at timestamptz,phone text);
create table private.kp_companies(id_empresa bigint,enabled boolean,phone_number_id text);
create table private.kp_jobs(id uuid default gen_random_uuid(),contact_id uuid,step int,status text default 'pending',due_at timestamptz,generation int,message_id text,reserved_at timestamptz,token uuid,body text,error text);
create unique index jobs_step on private.kp_jobs(contact_id,step) where step<=5;
create table private.kp_replies(contact_id uuid,decision text);
create table private.kp_templates(id_empresa bigint,step int,approved boolean);
create table private.kp_handoffs(contact_id uuid,status text,seen_at timestamptz,notice_state text);
create function public.wa_marketing_send_guard(text,text,bigint) returns boolean language sql as $$select coalesce(current_setting('test.blocked',true),'false')<>'true'$$;
create function public.crm_whatsapp_set_conversation_attendance(bigint,boolean,boolean) returns boolean language plpgsql as $$begin update public.lead set atendimento_humano=false,wa_conversation_assigned_to=null where id=$1;return true;end$$;
`;
async function call(extra = "") { return (await db.query<{result: any}>(`select public.hub_resume_prospect_followups(35,100${extra}) result`)).rows[0].result; }
let future: string;
describe("manual prospect follow-up resumption", () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(fixture + sql + readFileSync(resolve("docs/prospect-fast-resume-worker.sql"), "utf8").split("do $patch$")[0]); }, 30000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec(`truncate private.kp_resume_requests,private.kp_contacts,public.crm_users cascade;
      truncate public.lead,public.hub_company_modules,public.crm_lead_activities,private.kp_companies,private.kp_jobs,private.kp_replies,private.kp_templates,private.kp_handoffs;
      select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.blocked','false',false);
      insert into public.crm_users values('${actor}','${actor}',true,'super_admin',null);
      insert into public.lead values(100,35,'${actor}',true);
      insert into public.hub_company_modules values(35,true);
      insert into private.kp_companies values(35,true,'phone');
      insert into private.kp_contacts values('${contact}',100,500,35,'human',5,now()-interval '1 day',now()-interval '2 hours','5511999999999');
      insert into private.kp_jobs(contact_id,step,status,generation) select '${contact}',s,'cancelled',4 from generate_series(1,3)s;
      insert into private.kp_templates select 35,s,true from generate_series(1,3)s;
      insert into private.kp_handoffs values('${contact}','assumed',now(),'sent');`);
    future = (await db.query<{at:string}>("select (private.kp_next_business_time((current_date+7+time '08:00') at time zone 'America/Sao_Paulo'))::text at")).rows[0].at;
  });
  it("previews without releasing the conversation or scheduling", async () => {
    expect((await call()).steps).toEqual([1,2,3]);
    expect((await db.query<{status:string}>("select status from private.kp_contacts")).rows[0].status).toBe("human");
  });
  it("automatically schedules in five minutes or the next window, and retries are idempotent", async () => {
    await db.exec("update private.kp_contacts set last_sent_at=clock_timestamp(); update private.kp_jobs set status='accepted' where step=1");
    const preview = await call();
    expect(preview.scheduled.map((x:any)=>x.step)).toEqual([2,3]);
    const result = await call(`,null,5,'${req}'`);
    expect(result.fast_resume).toBe(true);
    expect(result.scheduled.map((x:any)=>x.step)).toEqual([2,3]);
    const expected = (await db.query<{at:string}>("select private.kp_next_business_time(clock_timestamp()+interval '5 minutes')::text at")).rows[0].at;
    expect(Math.abs(new Date(result.scheduled[0].due_at).getTime()-new Date(expected).getTime())).toBeLessThan(3000);
    expect(await call(`,null,5,'${req}'`)).toEqual(result);
    expect((await db.query(`select private.kp_is_fast_resume('${contact}',6,2) allowed, private.kp_is_fast_resume('${contact}',5,2) stale, private.kp_is_fast_resume('${contact}',6,3) later`)).rows[0]).toEqual({allowed:true,stale:false,later:false});
    expect(new Date(result.scheduled[1].due_at).getTime()-new Date(result.scheduled[0].due_at).getTime()).toBeGreaterThanOrEqual(27*3600000);
  });
  it("releases and schedules only unsent steps; duplicate request is harmless", async () => {
    await db.exec("update private.kp_jobs set status='accepted',message_id='wamid.done' where step=1");
    const first = await call(`,'${future}',5,'${req}'`);
    expect(first.scheduled.map((x:any)=>x.step)).toEqual([2,3]);
    expect(await call(`,'${future}',5,'${req}'`)).toEqual(first);
    expect((await db.query<{atendimento_humano:boolean}>("select atendimento_humano from public.lead")).rows[0].atendimento_humano).toBe(false);
    expect((await db.query("select generation,status from private.kp_contacts")).rows[0]).toMatchObject({generation:6,status:"active"});
    expect((await db.query("select message_id,status from private.kp_jobs where step=1")).rows[0]).toMatchObject({message_id:"wamid.done",status:"accepted"});
    expect((await db.query<{n:number}>("select count(*)::int n from public.crm_lead_activities")).rows[0].n).toBe(1);
  });
  it("rejects stale dialogs without releasing human attendance", async () => {
    await expect(call(`,'${future}',4,'${req}'`)).rejects.toThrow("conversa mudou");
    expect((await db.query<{atendimento_humano:boolean}>("select atendimento_humano from public.lead")).rows[0].atendimento_humano).toBe(true);
  });
  it("also schedules company 2 and preserves the 21h / 27h gaps when within working hours", async () => {
    await db.exec("update private.kp_contacts set id_empresa=36;update public.lead set id_empresa=36;update public.hub_company_modules set id_empresa=36;update private.kp_companies set id_empresa=36;update private.kp_templates set id_empresa=36");
    const result=(await db.query<{result:any}>(`select public.hub_resume_prospect_followups(36,100,'${future}',5,'${req}') result`)).rows[0].result;
    expect(result.scheduled.map((x:any)=>x.step)).toEqual([1,2,3]);
    const times=result.scheduled.map((x:any)=>new Date(x.due_at).getTime());
    expect(times[1]-times[0]).toBeGreaterThanOrEqual(21*3600000);
    expect(times[2]-times[1]).toBeGreaterThanOrEqual(27*3600000);
  });
  it("replaying an agent request works after the original release", async () => {
    await db.exec("update public.crm_users set role='agent',id_empresa=35");
    const first=await call(`,'${future}',5,'${req}'`);
    expect(await call(`,'${future}',5,'${req}'`)).toEqual(first);
  });
  it.each(["declined","stopped","review"])("blocks %s contacts", async status => {
    await db.query("update private.kp_contacts set status=$1",[status]);
    expect((await call()).available).toBe(false);
  });
  it("does not retry uncertain transport outcomes", async () => {
    await db.exec("update private.kp_jobs set reserved_at=now(),status='cancelled' where step=2");
    await expect(call(`,'${future}',5,'${req}'`)).rejects.toThrow("sem confirmação");
  });
  it("respects marketing blocks and completed cadences", async () => {
    await db.exec("select set_config('test.blocked','true',false)");
    expect((await call()).available).toBe(false);
    await db.exec("select set_config('test.blocked','false',false);update private.kp_jobs set status='accepted'");
    expect((await call()).reason).toContain("já foram enviados");
  });
  it("denies anonymous, inactive and cross-company actors", async () => {
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await expect(call()).rejects.toThrow("Sem acesso");
    await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false);update public.crm_users set role='manager',id_empresa=36`);
    await expect(call()).rejects.toThrow("Sem acesso");
    await db.exec("update public.crm_users set role='super_admin',active=false");
    await expect(call()).rejects.toThrow("Sem acesso");
  });
  it("does not allow agents to release another attendant's conversation", async () => {
    await db.exec("update public.crm_users set role='agent',id_empresa=35;update public.lead set wa_conversation_assigned_to=null");
    await expect(call()).rejects.toThrow("Assuma a conversa");
  });
  it("moves Friday evening and weekend to Monday 8am", async () => {
    const result=await db.query<{at:string;weekend:string}>("select private.kp_next_business_time('2026-11-13 18:50-03') at,private.kp_next_business_time('2026-11-14 12:00-03') weekend");
    expect(new Date(result.rows[0].at as string).toISOString()).toBe("2026-11-16T11:00:00.000Z");
    expect(new Date(result.rows[0].weekend as string).toISOString()).toBe("2026-11-16T11:00:00.000Z");
  });
});
