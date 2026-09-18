import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {prepareAlert,classifyAlertResponse} from './qualified-whatsapp-alert.mjs';

// Reference contains secrets and stays in ignored backups. Never copy it into Git.
const reference=JSON.parse(fs.readFileSync('mcp/backups/2026-09-18T17-04-33-980Z-reference_qualified_whatsapp_alert-SbrnKQgQ5S6yqZuf.json','utf8'));
const mk=(name,type,parameters,version=2)=>({id:crypto.randomUUID(),name,type,typeVersion:version,position:[0,0],parameters});
const trigger=mk('A cada minuto','n8n-nodes-base.scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:1}]}},1.2);
const claim=mk('Reservar alertas confirmados','n8n-nodes-base.postgres',{operation:'executeQuery',query:'select * from private.claim_qualified_whatsapp_alerts(10);',options:{}},2.6);
claim.credentials=structuredClone(reference.nodes.find(n=>n.name==='Create a row').credentials);
const prepare=mk('Preparar alerta','n8n-nodes-base.code',{mode:'runOnceForEachItem',jsCode:`const prepareAlert=${prepareAlert.toString()}; return {json:prepareAlert($json)};`});
const send=structuredClone(reference.nodes.find(n=>n.name==='Enviar Mensagem Grupo'));
send.id=crypto.randomUUID();send.name='Evolution - Novo lead qualificado';
send.parameters.jsonBody='={{ {number:$json.number,text:$json.text,linkPreview:false} }}';
send.parameters.options={timeout:20000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}};
send.onError='continueRegularOutput';send.retryOnFail=false;delete send.continueOnFail;
const result=mk('Conferir recibo Evolution','n8n-nodes-base.code',{mode:'runOnceForEachItem',jsCode:`const classifyAlertResponse=${classifyAlertResponse.toString()}; const source=$('Preparar alerta').item.json; return {json:{alert_id:source.alert_id,claim_token:source.claim_token,...classifyAlertResponse($json)}};`});
const finish=mk('Registrar resultado do alerta','n8n-nodes-base.postgres',{
  operation:'executeQuery',query:'select private.finish_qualified_whatsapp_alert($1::uuid,$2::uuid,$3::text,$4::text,$5::text) as recorded;',
  options:{queryBatching:'independently',queryReplacement:'={{ [$json.alert_id,$json.claim_token,$json.status,$json.message_id,$json.error] }}'},
},2.6);finish.credentials=structuredClone(claim.credentials);
const check=mk('Sinalizar falha para revisão','n8n-nodes-base.code',{mode:'runOnceForEachItem',jsCode:"const result=$('Conferir recibo Evolution').item.json; if($json.recorded!==true || result.status!=='sent') throw new Error('Alerta de qualificação requer revisão: '+result.alert_id+' ('+result.status+'). Conferir recibo antes de reenviar.'); return {json:{alert_id:result.alert_id,status:'sent'}};"});
const nodes=[trigger,claim,prepare,send,result,finish,check];nodes.forEach((n,i)=>n.position=[i*260,0]);
const connections={};for(let i=0;i<nodes.length-1;i++)connections[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};
const workflow={name:'Qualificados - Alerta WhatsApp após envio CRM',nodes,connections,settings:{executionOrder:'v1',timezone:'America/Sao_Paulo',executionTimeout:300,saveDataSuccessExecution:'none',saveDataErrorExecution:'all',errorWorkflow:'5kqgdv2SXGanBxGU'}};
const base=process.env.N8N_API_URL?.replace(/\/$/,'');const key=process.env.N8N_API_KEY;assert(base&&key);
const headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'};
async function api(path,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,`n8n ${method} ${path}: ${r.status}`);return r.json();}
const statePath='mcp/backups/qualified-whatsapp-alert-workflow.json';
assert(!fs.existsSync(statePath),'Workflow already created. Inspect saved ID before another deployment.');
const created=await api('/workflows','POST',workflow);
fs.writeFileSync(statePath,JSON.stringify({id:created.id}));
assert.equal(created.nodes.length,7);
console.log(JSON.stringify({created:true,id:created.id,active:created.active}));
if(process.argv.includes('--activate')){
  await api(`/workflows/${created.id}/activate`,'POST',{});
  const live=await api(`/workflows/${created.id}`);
  assert(live.active);assert.equal(live.activeVersionId,live.versionId);
  assert.equal(live.nodes.find(n=>n.name===send.name).parameters.jsonBody,send.parameters.jsonBody);
  console.log(JSON.stringify({active:true,id:live.id,version:live.versionId}));
}
