import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMaestro } from '../supabase/functions/external-crms-dispatch/maestro.ts';
const input={url:'https://crm.maestroia.com.br/api/v1',token:'secret-test',companyId:34,leadId:500,name:'Teste',phone:'+55 (11) 99999-9999',email:'provisorio+34-1@gmail.com',pipelineId:2,stageId:26,tags:['Visita Agendada IA'],summary:'Resumo'};
function mock({existing=null,badReadback=false,noteFailure=false,badList=false,createMissingId=false}={}) {
 const calls=[];
 const fetch=async(url,options)=>{
   const path=new URL(url).pathname.replace('/api/v1','');
   const body=options.body?JSON.parse(options.body):null;
   calls.push({path,method:options.method,body,options});
   let result;
   if(path==='/pessoas')result={pessoa:{id:7}};
   else if(path==='/pessoas/7/conversas')result=badList?{}:{conversas:existing?[existing]:[]};
   else if(path==='/conversas')result=createMissingId?{}:{conversa:{id:8}};
   else if(path==='/conversas/8')result={conversa:{id:8,pessoa_id:7,funil_id:2,stage_id:badReadback?21:26,status:'em_aberto'}};
   else if(path==='/interacoes')return Response.json(noteFailure?{error:'failed'}:{ok:true},{status:noteFailure?500:200});
   else throw new Error('Unexpected '+path);
   return Response.json(result);
 };
 return {calls,fetch};
}
test('creates person and conversation, confirms stage and saves stable summary identity',async()=>{
 const m=mock();const r=await dispatchMaestro(input,m.fetch);
 assert.equal(r.externalId,'8');assert.equal(r.summarySynced,true);
 assert.equal(m.calls[0].body.email,undefined);
 assert.equal(m.calls[0].body.lead_externo_id,'katsuki_34_5511999999999');
 assert.equal(m.calls[2].body.stage_id,26);
 assert.equal(m.calls.at(-1).body.externo_id,'katsuki_hub_34_500_8_26');
 assert(!JSON.stringify(r).includes('secret-test'));
 assert(m.calls.every(c=>c.options.redirect==='error'));
});
for(const status of ['em_aberto','fechada'])test('reuses '+status+' conversation without duplicate POST',async()=>{
 const m=mock({existing:{id:8,status}});const r=await dispatchMaestro({...input,email:'lead@example.com'},m.fetch);
 assert.equal(r.responsePayload.reused,true);
 assert(!m.calls.some(c=>c.path==='/conversas'&&c.method==='POST'));
 assert.equal(m.calls[2].body.status,status==='em_aberto'?undefined:'em_aberto');
 assert.equal(m.calls[0].body.email,'lead@example.com');
});
test('rejects missing configuration before any remote write',async()=>{
 for(const field of ['phone','token','pipelineId','stageId']){
  const m=mock();await assert.rejects(dispatchMaestro({...input,[field]:''},m.fetch));assert.equal(m.calls.length,0);
 }
});
test('does not create on malformed list or report success without ID/readback',async()=>{
 for(const config of [{badList:true},{createMissingId:true},{badReadback:true}]){
  const m=mock(config);await assert.rejects(dispatchMaestro(input,m.fetch));
  assert(!m.calls.some(c=>c.path==='/interacoes'));
  if(config.badList)assert(!m.calls.some(c=>c.path==='/conversas'));
 }
});
test('summary failure preserves successful CRM receipt',async()=>{
 const m=mock({noteFailure:true});const r=await dispatchMaestro(input,m.fetch);
 assert.equal(r.externalId,'8');assert.equal(r.summarySynced,false);assert(r.summaryError);
});
