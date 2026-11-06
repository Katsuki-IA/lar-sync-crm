import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const actor='00000000-0000-4000-8000-000000000001';
const q=async(s,p=[]) => (await db.query(s,p)).rows;
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create schema auth;create role anon;create role authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table crm_users(auth_user_id uuid,active boolean,role text,id_empresa bigint);
 create function private.crm_can_access_empresa(bigint) returns boolean language sql as $$select exists(select 1 from public.crm_users where auth_user_id=auth.uid() and active and (role='super_admin' or id_empresa=$1))$$;
 create table hub_company_modules(id_empresa bigint,atendimento_ia boolean);
 create table crm_leads(id bigint,id_empresa bigint,lead_id bigint,created_at timestamptz,id_empreendimento bigint);
 create table lead(id bigint,id_empresa bigint,ativacao boolean);
 create table private.kp_contacts(id uuid,crm_lead_id bigint,id_empresa bigint,last_reply_at timestamptz);
 create table private.kp_handoffs(contact_id uuid);
 insert into crm_users values('${actor}',true,'super_admin',35);
 insert into hub_company_modules values(35,true),(36,true);
 insert into crm_leads values(1,35,11,'2026-11-06T03:00:00Z',null),(2,35,12,'2026-11-07T02:59:59Z',null),(3,35,13,'2026-11-07T03:00:00Z',null),(4,36,14,'2026-11-06T12:00:00Z',null);
 insert into lead values(11,35,null),(12,35,null),(13,35,null),(14,36,null);
 insert into private.kp_contacts values('00000000-0000-4000-8000-000000000011',1,35,'2026-11-06T04:00:00Z'),('00000000-0000-4000-8000-000000000012',2,35,null),('00000000-0000-4000-8000-000000000014',4,36,'2026-11-06T13:00:00Z');
 insert into private.kp_handoffs values('00000000-0000-4000-8000-000000000011');
 `);await db.exec(await fs.readFile(new URL('./prospect-funnel-counts.sql',import.meta.url),'utf8'));await q("select set_config('test.actor',$1,false)",[actor]);
});
after(async()=>await db?.close());
const counts=(company=35,type='all',project=null)=>q("select public.hub_kp_funnel_counts($1,'2026-11-06','2026-11-06',$2,$3) as counts",[company,project,type]);
test('counts distinct cohort leads using Sao Paulo day boundaries and campaign evidence',async()=>assert.deepEqual((await counts())[0].counts,{received:2,engaged:1,hot:0,sentToCrm:1,scheduled:0}));
test('isolates the other company',async()=>assert.deepEqual((await counts(36))[0].counts,{received:1,engaged:1,hot:0,sentToCrm:0,scheduled:0}));
test('campaign contacts count as activation even without legacy activation flag',async()=>{
 assert.equal((await counts(35,'activation'))[0].counts.received,2);assert.equal((await counts(35,'inbound'))[0].counts.received,0);
});
test('project filter cannot accidentally include projectless contacts',async()=>assert.equal((await counts(35,'all',999))[0].counts.received,0));
test('rejects noncampaign company and reversed dates',async()=>{
 await assert.rejects(counts(19),/Empresa fora/);await assert.rejects(q("select public.hub_kp_funnel_counts(35,'2026-11-07','2026-11-06')"),/Filtros/);
});
test('rejects unauthenticated and crosscompany manager access',async()=>{
 await q("select set_config('test.actor','',false)");await assert.rejects(counts(),/permissão/);
 await q("select set_config('test.actor',$1,false)",[actor]);await q("update crm_users set role='manager'");await assert.rejects(counts(36),/permissão/);assert.equal((await counts())[0].counts.received,2);
 await q("update crm_users set role='super_admin'");
});
test('rejects inactive users and agents even within their company',async()=>{
 await q("update crm_users set role='agent'");await assert.rejects(counts(),/permissão/);await q("update crm_users set role='super_admin',active=false");await assert.rejects(counts(),/permissão/);await q('update crm_users set active=true');
});
test('anonymous role cannot execute either endpoint',async()=>{
 const rows=await q("select has_function_privilege('anon','public.hub_kp_funnel_counts(bigint,date,date,bigint,text)','execute') a,has_function_privilege('anon','private.hub_kp_funnel_counts(bigint,date,date,bigint,text)','execute') b");assert.deepEqual(rows[0],{a:false,b:false});
});
