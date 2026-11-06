import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;const q=async(s,p=[]) => (await db.query(s,p)).rows;
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;
 create table crm_leads(id bigint primary key,id_empresa bigint,crm_stage_id bigint);
 create table lead(id bigint primary key,id_empresa bigint,atendimento_humano boolean default false,wa_conversation_assigned_to uuid);
 create table crm_funnels(id bigint primary key,id_empresa bigint,module text,ativo boolean default true);
 create table crm_stages(id bigint primary key,id_empresa bigint,id_funnel bigint,module text,ativo boolean default true,global_stage_id bigint,nome text);
 create table crm_lead_activities(id bigserial primary key,lead_id bigint,tipo text,descricao text,metadata jsonb);
 create table crm_opportunities(id uuid primary key,lead_id bigint,id_empresa bigint,stage_id bigint);
 create table private.hub_sales_waiting(opportunity_id uuid,id_empresa bigint);
 create table private.hub_queue_intake(lead_id bigint,id_empresa bigint);
 create table private.kp_contacts(id uuid primary key default gen_random_uuid(),id_empresa bigint,crm_lead_id bigint,legacy_lead_id bigint,status text default 'active',first_sent_at timestamptz,last_sent_at timestamptz,last_reply_at timestamptz);
 create table private.kp_jobs(id uuid primary key default gen_random_uuid(),contact_id uuid,step int,status text,accepted_at timestamptz,reserved_at timestamptz);
 create table private.kp_handoffs(contact_id uuid);
 `);await db.exec(await fs.readFile(new URL('./prospect-ia-stage-sync.sql',import.meta.url),'utf8'));
});
after(async()=>await db?.close());
beforeEach(async()=>{
 await db.exec('truncate crm_leads,lead,crm_funnels,crm_stages,crm_lead_activities,crm_opportunities,private.hub_sales_waiting,private.hub_queue_intake,private.kp_contacts,private.kp_jobs,private.kp_handoffs');
 for(const company of [35,36,19]) {
  await q("insert into crm_funnels values($1,$1,'ia',true)",[company]);
  for(const global of [1,2,7,8,9,10,12,13]) await q("insert into crm_stages values($1,$2,$2,'ia',true,$3,$4)",[company*100+global,company,global,'Stage '+global]);
 }
});
async function contact(company=35,stage=null){
 await q('insert into crm_leads values($1,$1,$2)',[company,stage]);await q('insert into lead(id,id_empresa) values($1,$1)',[company]);
 return (await q('insert into private.kp_contacts(id_empresa,crm_lead_id,legacy_lead_id) values($1,$1,$1) returning *',[company]))[0];
}
const stage=async(company=35)=>(await q('select crm_stage_id from crm_leads where id=$1',[company]))[0]?.crm_stage_id;
const send=(c,step,time='2026-11-06T12:00:00Z',status='accepted')=>q('insert into private.kp_jobs(contact_id,step,status,accepted_at,reserved_at) values($1,$2,$3,$4,$4) returning id',[c.id,step,status,time]);
test('materialized contact begins in Base; unmaterialized source creates no CRM lead',async()=>{
 await contact();assert.equal(await stage(),3501);
 await q("insert into private.kp_contacts(id_empresa) values(35)");assert.equal((await q('select count(*)::int n from crm_leads'))[0].n,1);
});
test('opening only advances after acceptance and FUPs track confirmed step',async()=>{
 const c=await contact();const [j]=await send(c,0,undefined,'sending');assert.equal(await stage(),3501);
 await q("update private.kp_jobs set status='accepted' where id=$1",[j.id]);assert.equal(await stage(),3502);
 for(const step of [1,2,3]){await send(c,step,`2026-11-06T${12+step}:00:00Z`);assert.equal(await stage(),3507+step);}
});
test('company36 maps to its own stages, never company35',async()=>{const c=await contact(36);await send(c,2);assert.equal(await stage(36),3609);});
test('noncampaign company is untouched',async()=>{const c=await contact(19);await send(c,2);assert.equal(await stage(19),null);});
test('presentation moves a waiting lead to Contato Feito after an earlier FUP',async()=>{const c=await contact();await send(c,1);await send(c,4,'2026-11-06T13:00:00Z');assert.equal(await stage(),3502);});
test('confirmed handoff wins over followups and leaves commercial opportunity stage intact',async()=>{
 const c=await contact();await send(c,1);
 await q("insert into crm_opportunities values('00000000-0000-4000-8000-000000000001',35,35,196)");
 await q("insert into private.hub_sales_waiting values('00000000-0000-4000-8000-000000000001',35)");
 await q('insert into private.kp_handoffs values($1)',[c.id]);assert.equal(await stage(),3513);
 await send(c,3,'2026-11-06T14:00:00Z');assert.equal(await stage(),3513);
 assert.equal((await q('select stage_id from crm_opportunities'))[0].stage_id,196);assert.equal((await q('select count(*)::int n from private.hub_sales_waiting'))[0].n,0);
});
test('manual takeover leaves IA funnel as Enviado ao CRM',async()=>{await contact();await q('update lead set atendimento_humano=true');await q("update private.kp_contacts set status='human'");assert.equal(await stage(),3513);});
test('decline maps to Perdido and stop maps to Bloqueio',async()=>{await contact();await q("update private.kp_contacts set status='declined'");assert.equal(await stage(),3507);await q("update private.kp_contacts set status='stopped'");assert.equal(await stage(),3512);});
test('transport review blocks, ambiguous reply review retains acknowledged stage',async()=>{
 const c=await contact();await send(c,0);await q("update private.kp_contacts set status='review'");assert.equal(await stage(),3502);
 await send(c,1,'2026-11-06T13:00:00Z','review');assert.equal(await stage(),3512);
});
test('preserves preexisting blocked/manual stages',async()=>{const c=await contact(35,3512);await send(c,1);assert.equal(await stage(),3512);assert.equal((await q('select count(*)::int n from crm_lead_activities'))[0].n,0);});
test('manual move after synchronization is preserved',async()=>{const c=await contact();await q('update crm_leads set crm_stage_id=3512');await send(c,2);assert.equal(await stage(),3512);});
test('duplicate projection does not duplicate activity',async()=>{const c=await contact();await q('select private.kp_sync_ia_stage($1)',[c.id]);assert.equal((await q('select count(*)::int n from crm_lead_activities'))[0].n,1);});
test('renamed global stage still works; absent stage never rolls back send receipt',async()=>{
 const c=await contact();await q("update crm_stages set nome='Renomeado' where id=3502");await send(c,0);assert.equal(await stage(),3502);
 await q('delete from crm_stages where id=3508');await send(c,1,'2026-11-06T13:00:00Z');assert.equal(await stage(),3502);assert.equal((await q("select count(*)::int n from private.kp_jobs where status='accepted'"))[0].n,2);
});
test('private functions are not executable by application users',async()=>{assert.equal((await q("select has_function_privilege('authenticated','private.kp_sync_ia_stage(uuid)','execute') ok"))[0].ok,false);});
