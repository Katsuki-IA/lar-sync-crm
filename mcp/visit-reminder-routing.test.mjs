import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { preserveVisit, resolveReminderSql, recordReminderSql, preserveReceiptSql, patchReminder, patchBroker, patchService, PRESERVED_REPLY } from './visit-reminder-routing.mjs';
import { readFile } from 'node:fs/promises';

const response=(stage=9,owner=126,id=40248)=>({leads:[{idlead:id,situacao:{id:stage},corretor:{id:owner}}]});
test('AR: scheduled visit keeps existing broker; no other tenant is affected',()=>{
  assert.equal(preserveVisit(19,40248,9,response()).receipt.broker_id,126);
  assert.equal(preserveVisit(19,40248,9,response(2)).preserve,false);
  assert.equal(preserveVisit(9,40248,9,response()).preserve,false);
  for(const bad of [response(9,null),response(9,126,123),{leads:[]},{leads:[...response().leads,...response().leads]},response(null)])
    assert.throws(()=>preserveVisit(19,40248,9,bad));
});

test('SQL: reminder identity, idempotency and preserved handoff leave operational lead unchanged',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create schema private;
   create table public.lead(id bigint primary key,id_empresa bigint,id_crm text,numero text,nome text,conversation_key text,legacy_conversation_key text,wa_identity_id uuid,wa_user_id text,wa_username text,status text,atendimento_humano boolean);
   create table public.agendamento(id bigint primary key,id_empresa bigint,id_lead bigint,id_empreendimento bigint,day date,time time,deleted_at timestamptz);
   create table public.credentials(id_empresa bigint,whatsapp_business_id text);
   create table public.empreendimento(id bigint,id_empresa bigint,nome text);
   create table private.ai_realtime_history(company_id bigint,lead_id bigint,event_key text,role text,body text,occurred_at timestamptz,primary key(company_id,lead_id,event_key));
   create table public.n8n_chat_conversas(id bigint generated always as identity,numero text,message jsonb,time timestamptz,type text,id_empresa bigint,telefone text,conversation_key text,legacy_conversation_key text,wa_identity_id uuid,wa_user_id text,wa_username text);
   create table private.broker_handoff_attempts(service_execution_id text,company_id bigint,lead_id bigint,broker_execution_id text,status text,receipt jsonb,confirmed_at timestamptz);
   insert into public.lead(id,id_empresa,id_crm,numero,nome,conversation_key,legacy_conversation_key,status,atendimento_humano) values(31306,19,'40248','5531984866969','Ana','wa:v2:ana','553198486696919','agendado',false),(99,9,'40248','5531984866969','Outro','wa:v2:other','55319848669699','agendado',false);
   insert into public.agendamento values(1570,19,31306,49,(clock_timestamp() at time zone 'America/Sao_Paulo')::date+1,'18:00',null);
   insert into public.credentials values(19,'907191919148567');
   insert into public.empreendimento values(49,19,'Bliss Cuore');
   insert into private.broker_handoff_attempts values('exec',19,31306,'broker','pending',null,null);`);
  const args=[1570,'5531984866969','907191919148567','18h00','Ana'];
  const resolved=(await db.query(resolveReminderSql,args)).rows;
  assert.equal(resolved.length,1); assert.equal(Number(resolved[0].company_id),19);
  for(const bad of [[1570,'wrong',args[2],args[3],args[4]],[1570,args[1],'other',args[3],args[4]],[1570,args[1],args[2],'19h00',args[4]],[1570,args[1],args[2],args[3],'other']])
   assert.equal((await db.query(resolveReminderSql,bad)).rows.length,0);
  const body=resolved[0].reminder_text;
  assert.match(body,/Confirma sua presença/);
  for(let i=0;i<2;i++)await db.query(recordReminderSql,[19,31306,'wamid.test',body]);
  await db.query(recordReminderSql,[9,31306,'wamid.crossTenant',body]);
  await db.query(recordReminderSql,[19,31306,'',body]);
  const history=(await db.query('select * from n8n_chat_conversas')).rows;
  assert.equal(history.length,1); assert.equal(history[0].conversation_key,'wa:v2:ana');
  assert.equal(Number(history[0].id_empresa),19); assert.equal(history[0].numero,'553198486696919');
  assert.equal(history[0].message,body);
  const before=(await db.query('select * from lead order by id')).rows;
  const receipt=preserveVisit(19,40248,9,response()).receipt;
  assert.equal((await db.query(preserveReceiptSql,['exec',19,31306,'broker',JSON.stringify({...receipt,external_id:'wrong'})])).rows[0].preserved_existing_visit,false);
  assert.equal((await db.query(preserveReceiptSql,['exec',19,31306,'broker',JSON.stringify(receipt)])).rows[0].preserved_existing_visit,true);
  assert.deepEqual((await db.query('select * from lead order by id')).rows,before);
  assert.equal((await db.query(preserveReceiptSql,['exec',19,31306,'broker',JSON.stringify(receipt)])).rows[0].preserved_existing_visit,false);
 }finally{await db.close();}
});

// Optional structural/replay tests against downloaded live workflows; never execute a network node.
const dir=process.env.VISIT_FIX_FIXTURES;
test('live workflow patch: protected branch has no CRM write or attendance mutation', {skip:!dir},async()=>{
 const read=async id=>JSON.parse((await readFile(`${dir}/visit-fix-${id}.json`,'utf8')).replace(/^\uFEFF/,''));
 const b=patchBroker(await read('K6Ra0NieeLWEFi1w'));
 const guard=b.nodes.find(n=>n.name==='AR - Avaliar visita existente');
 const call=new Function('$','$json',guard.parameters.jsCode);
 const result=call(()=>({first:()=>({json:{id_crm:40248,scheduled:9}})}),response());
 assert.equal(result[0].json.preserve,true);
 const next=(name,index=0)=>b.connections[name]?.main?.[index]?.map(e=>e.node)??[];
 assert.deepEqual(next('Corretor - Validar mensagem antes do repasse'),['AR - Verificar visita antes do repasse']);
 assert.deepEqual(next('AR - Preservar visita?',0),['AR - Registrar preservação']);
 assert.deepEqual(next('AR - Registrar preservação'),['AR - Resultado visita preservada']);
 assert.deepEqual(next('AR - Resultado visita preservada'),[]);
 assert.deepEqual(next('AR - Preservar visita?',1),['Corretor - Reutilizar qualificado enviado']);
 const s=patchService(await read('EYvXhZTBgM9qi2pp'));
 const code=s.nodes.find(n=>n.name==='Corretor - Liberar resposta validada').parameters.jsCode;
 const run=(response,proof)=>new Function('$input',code)({all:()=>[{json:{response,handoff_proof:proof}}]})[0].json;
 assert.equal(run({output:'Passei para outro corretor',broker_handoff_attempted:true},{confirmed:true,preserved_existing_visit:true}).output,PRESERVED_REPLY);
 assert.equal(run({output:'Fake',preserved_existing_visit:true,broker_handoff_attempted:true},{confirmed:false}).broker_handoff_blocked,true);
 assert.equal(run({output:'normal'},{attempted:false}).output,'normal');
 const r=patchReminder(await read('Mv0eUkTI8WspBnOR'));
 assert.equal(r.nodes.some(n=>n.name==='Postgres Chat Memory1'),false);
 assert.deepEqual(r.connections['Envia Aviso Agendamento'].main[0].map(e=>e.node),['Lembrete - Validar aceite Meta']);
 const validate=new Function('$json',r.nodes.find(n=>n.name==='Lembrete - Validar aceite Meta').parameters.jsCode);
 assert.throws(()=>validate({error:{message:'failed'}}));
 assert.equal(validate({messages:[{id:'wamid.ok'}]})[0].json.meta_message_id,'wamid.ok');
});
