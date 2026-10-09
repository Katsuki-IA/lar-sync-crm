import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Pass the PGlite installation path; the test never connects to a production database.
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.empresa_dados(id bigint primary key);
  create table public.crm_leads(id bigint primary key,id_empresa bigint);
  create table public.crm_external_crm_send_logs(id bigint primary key,id_empresa bigint,lead_id bigint,external_id text,provider text,status text,created_at timestamptz,request_payload jsonb);
  create schema cron;
  create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
  insert into empresa_dados values(9),(10);
  insert into crm_leads values(101,9),(102,9),(201,10);
`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261009182538_kommo_project_identification.sql', import.meta.url), 'utf8'));
const one = async sql => (await db.query(sql)).rows[0];
assert.equal((await one("select relrowsecurity as enabled from pg_class where oid='public.crm_kommo_project_settings'::regclass")).enabled,true);
assert.equal((await one("select has_table_privilege('authenticated','public.crm_kommo_project_settings','SELECT') as allowed")).allowed,false);
assert.equal((await one("select has_table_privilege('anon','public.crm_kommo_project_sync','INSERT') as allowed")).allowed,false);
assert.equal((await one("select has_function_privilege('authenticated','public.kommo_project_acquire_lock(bigint,uuid)','EXECUTE') as allowed")).allowed,false);
assert.equal((await one("select has_function_privilege('service_role','public.kommo_project_acquire_lock(bigint,uuid)','EXECUTE') as allowed")).allowed,true);
await db.exec("insert into crm_kommo_project_settings(id_empresa,account_url,account_id,field_id,enabled) values(9,'https://fixture.kommo.com',1,100,true),(10,'https://other.kommo.com',2,200,true)");
const token1="'00000000-0000-4000-8000-000000000001'::uuid";
const token2="'00000000-0000-4000-8000-000000000002'::uuid";
assert.equal((await one(`select kommo_project_acquire_lock(9,${token1}) as acquired`)).acquired,true);
assert.equal((await one(`select kommo_project_acquire_lock(9,${token2}) as acquired`)).acquired,false);
await db.exec(`select kommo_project_release_lock(9,${token2})`);
assert.equal((await one(`select kommo_project_acquire_lock(9,${token2}) as acquired`)).acquired,false);
await db.exec(`select kommo_project_release_lock(9,${token1})`);
assert.equal((await one(`select kommo_project_acquire_lock(9,${token2}) as acquired`)).acquired,true);
await db.exec(`
  insert into crm_external_crm_send_logs values
    (1,9,101,'501','kommo','sent','2026-10-01','{}'),
    (2,9,101,'502','kommo','sent','2026-10-02','{"create_lead":[{"custom_fields_values":[{"field_id":100,"values":[{"enum_id":601}]}]}]}'),
    (3,9,102,'503','kommo','failed','2026-10-02','{}'),
    (4,9,201,'504','kommo','sent','2026-10-02','{}'),
    (5,10,201,'505','kommo','sent','2026-10-02','{}'),
    (6,9,102,'506','cv','sent','2026-10-02','{}');
  select kommo_project_seed_sync(9);
`);
let rows = (await db.query('select lead_id,external_id,last_enum_id,tracked from crm_kommo_project_sync')).rows;
assert.equal(rows.length,1);
assert.equal(Number(rows[0].lead_id),101);
assert.equal(Number(rows[0].external_id),502);
assert.equal(Number(rows[0].last_enum_id),601);
assert.equal(rows[0].tracked,true);
await db.exec("update crm_kommo_project_sync set status='conflict',last_enum_id=700; select kommo_project_seed_sync(9)");
assert.equal((await one('select status from crm_kommo_project_sync')).status,'conflict');
assert.equal(Number((await one('select last_enum_id from crm_kommo_project_sync')).last_enum_id),700);
await db.exec('select kommo_project_seed_sync(10)');
rows=(await db.query('select * from crm_kommo_project_sync where id_empresa=10')).rows;
assert.equal(rows.length,1);
assert.equal(rows[0].tracked,false);
assert.equal(rows[0].last_enum_id,null);
await db.close();
console.log('PostgreSQL local: RLS/grants, company locks, confirmed identity, tenant isolation, idempotent backfill and manual conflict preservation passed.');
