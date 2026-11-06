import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const T='2026-11-06T12:00:00Z', ANA='00000000-0000-4000-8000-000000000035';
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
before(async()=>{
 db=new PGlite(); await db.exec(await fs.readFile(new URL('./fixture.sql',import.meta.url),'utf8'));
 const defs=JSON.parse(await fs.readFile(new URL('./baseline.json',import.meta.url),'utf8'));
 for(const name of ['kp_claim','kp_complete','kp_preflight','kp_apply_reply','kp_capture_reply','kp_handoff_presented','kp_on_takeover']) await db.exec(defs.find(f=>f.name===name).def+';');
 await db.exec(await fs.readFile(new URL('../prospect1-presentation-followup.sql',import.meta.url),'utf8'));
 await db.exec('create trigger capture after insert on wa_messages for each row execute function private.kp_capture_reply();');
});
after(async()=>await db?.close());
beforeEach(async()=>{
 await db.exec('truncate private.kp_companies,private.kp_contacts,private.kp_jobs,private.kp_replies,private.kp_handoffs,wa_messages,lead,crm_leads,crm_stages,crm_users,empresa_dados,credentials,suppressed cascade');
 await db.exec(`insert into empresa_dados(id) values(35),(36);insert into crm_users(id) values('${ANA}');insert into crm_stages values(350,35,true),(360,36,true);`);
 for(const [id,op,phone,waba] of [[35,1,'1436339762890531','1356280729669671'],[36,2,'1464731120047687','2068502413844099']]) {
  await q('insert into private.kp_companies(id_empresa,operation,phone_number_id,waba_id,enabled,recipient_id,recipient_phone,interested_stage_id) values($1,$2,$3,$4,true,$5,\'5541999999999\',$6)',[id,op,phone,waba,ANA,id*10]);
  await q("insert into credentials values($1,$2,'test')",[id,phone]);
  for(let i=0;i<=3;i++) await q("insert into private.kp_templates(id_empresa,step,name,approved,body,media_type,media_id) values($1,$2,$3,true,'followup', $4,$5)",[id,i,'followup_'+i,i===0?null:i===2?'video':'image',i===0?null:'test-media']);
 }
});
async function contact(company=35){
 await q("insert into crm_leads(id,id_empresa,telefone) values($1,$1,'5541999999935')",[company]);
 await q("insert into lead(id,id_empresa,id_crm,numero) values($1,$1,$1::bigint::text,'5541999999935')",[company]);
 const [c]=await q("insert into private.kp_contacts(id_empresa,crm_lead_id,legacy_lead_id,company_key,phone,name,status,phase,generation,first_sent_at,last_reply_at,last_reply_id,last_sent_at) values($1,$1,$1,$1::bigint::text,'5541999999935','Fixture','answered','offer',1,$2::timestamptz-interval '10 minutes',$2::timestamptz-interval '2 minutes','first-reply',$2) returning *",[company,T]);
 await q("insert into private.kp_replies(id,contact_id,generation,body,status,decision) values('first-reply',$1,1,'Sim','done','response_received')",[c.id]);
 await q("insert into private.kp_jobs(contact_id,step,due_at,generation,status,accepted_at,message_id,token,reply_id) values($1,4,$2,1,'accepted',$2,'wamid.fixture',gen_random_uuid(),'first-reply')",[c.id,T]);
 for(let i=1;i<=3;i++) await q("insert into private.kp_jobs(contact_id,step,due_at,generation,status) values($1,$2,$3,0,'cancelled')",[c.id,i,T]);
 return c;
}
const schedule=(c,time=T)=>q('select private.kp_schedule_offer_followups($1,$2) as ok',[c.id,time]);
test('schedules 2/23/50h after presentation and is idempotent',async()=>{
 const c=await contact();assert.equal((await schedule(c))[0].ok,true);
 const rows=await q('select step,status,generation,extract(epoch from due_at-$1::timestamptz)/3600 as hours from private.kp_jobs where step<=3 order by step',[T]);
 assert.deepEqual(rows.map(r=>[r.status,r.generation,Number(r.hours)]),[['pending',1,2],['pending',1,23],['pending',1,50]]);
 assert.equal((await schedule(c))[0].ok,false);
 const jobs=await q("select private.kp_claim('followup',$1) as job",['2026-11-06T14:00:01Z']);assert.equal(jobs.length,1);assert.equal(jobs[0].job.payload.template.name,'followup_1');
});
test('overdue recovery preserves spacing instead of releasing all immediately',async()=>{
 const c=await contact();await schedule(c,'2026-11-07T12:00:00Z');
 const rows=await q("select extract(epoch from due_at-'2026-11-07T12:00:00Z'::timestamptz)/3600 as h from private.kp_jobs where step<=3 order by step");assert.deepEqual(rows.map(r=>Number(r.h)),[0,21,48]);
});
for(const guard of ['company36','human','assigned','declined','stopped','review','paused','new_reply','handoff']) test('does not rearm '+guard,async()=>{
 const c=await contact(guard==='company36'?36:35);
 if(guard==='human') await q('update lead set atendimento_humano=true');
 if(guard==='assigned') await q('update lead set wa_conversation_assigned_to=$1',[ANA]);
 if(['declined','stopped','review'].includes(guard)) await q('update private.kp_contacts set status=$1',[guard]);
 if(guard==='paused') await q('update private.kp_companies set enabled=false');
 if(guard==='new_reply') await q('update private.kp_contacts set generation=2');
 if(guard==='handoff') await q("insert into private.kp_handoffs(contact_id,reply_id) values($1,'first-reply')",[c.id]);
 assert.equal((await schedule(c))[0].ok,false);assert.equal((await q("select count(*)::int n from private.kp_jobs where status='pending'"))[0].n,0);
});
test('never replays accepted or uncertain send attempts',async()=>{
 const c=await contact();await q("update private.kp_jobs set status='accepted',message_id='wamid.fup1' where step=1");await q("update private.kp_jobs set reserved_at=$1,token=gen_random_uuid() where step=2",[T]);await schedule(c);
 assert.deepEqual((await q('select status from private.kp_jobs where step<=3 order by step')).map(r=>r.status),['accepted','cancelled','pending']);
});
test('new response cancels followups and hands off only after presentation',async()=>{
 const c=await contact();assert.equal((await q("select private.kp_handoff_presented($1,'first-reply') as ok",[c.id]))[0].ok,false);await schedule(c);
 await q("insert into wa_messages(phone_number_id,direction,from_wa_id,text_body,tenant_id,message_id,timestamp_meta) values('1436339762890531','inbound',$1,'Quero conhecer',35,'second-reply',$2)",[c.phone,'2026-11-06T13:00:00Z']);
 assert.equal((await q("select count(*)::int n from private.kp_jobs where status='pending'"))[0].n,0);
 const [r]=await q("update private.kp_replies set status='processing',token=gen_random_uuid() where id='second-reply' returning token");
 await q("select private.kp_apply_reply('second-reply',$1,'response_received')",[r.token]);assert.equal((await q('select count(*)::int n from private.kp_handoffs'))[0].n,1);
});
test('successful presentation schedules followups instead of handing company35 off',async()=>{
 const c=await contact();const [j]=await q("update private.kp_jobs set status='sending',accepted_at=null,message_id=null where step=4 returning *");
 await q("select private.kp_complete($1,$2,'wamid.new',null,$3)",[j.id,j.token,T]);
 assert.equal((await q("select count(*)::int n from private.kp_jobs where status='pending'"))[0].n,3);assert.equal((await q('select count(*)::int n from private.kp_handoffs'))[0].n,0);
});
test('company36 preserves handoff on accepted presentation',async()=>{
 await contact(36);const [j]=await q("update private.kp_jobs set status='sending',accepted_at=null,message_id=null where step=4 returning *");
 await q("select private.kp_complete($1,$2,'wamid.new',null,$3)",[j.id,j.token,T]);assert.equal((await q('select count(*)::int n from private.kp_handoffs'))[0].n,1);
});
test('transport failure does not start post-presentation followups',async()=>{
 await contact();const [j]=await q("update private.kp_jobs set status='sending',accepted_at=null,message_id=null where step=4 returning *");
 await q("select private.kp_complete($1,$2,null,'failed',$3)",[j.id,j.token,T]);assert.equal((await q("select count(*)::int n from private.kp_jobs where status='pending'"))[0].n,0);
});
