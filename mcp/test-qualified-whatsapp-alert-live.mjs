// Executes the real n8n node chain against an isolated HTTP mock, not WhatsApp.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base=process.env.N8N_API_URL?.replace(/\/$/,'');const key=process.env.N8N_API_KEY;assert(base&&key);
const headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'};
async function api(path,method='GET',body){const r=await fetch(base+'/api/v1'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});assert(r.ok,`${method} ${path}: ${r.status}`);return r.json();}
const {id:productionId}=JSON.parse(fs.readFileSync('mcp/backups/qualified-whatsapp-alert-workflow.json'));
const production=await api(`/workflows/${productionId}`);
const nodes=structuredClone(production.nodes);const connections=structuredClone(production.connections);
const testPath='qa-qualified-alert-'+crypto.randomUUID();const echoPath='qa-qualified-echo-'+crypto.randomUUID();
const trigger=nodes.find(n=>n.name==='A cada minuto');
trigger.type='n8n-nodes-base.webhook';trigger.typeVersion=2;trigger.webhookId=crypto.randomUUID();
trigger.parameters={httpMethod:'POST',path:testPath,responseMode:'lastNode',options:{}};
const claim=nodes.find(n=>n.name==='Reservar alertas confirmados');
claim.parameters.query=`select gen_random_uuid() as alert_id,gen_random_uuid() as claim_token,'120363000000000000@g.us' as group_id,
  'Lead Sintético' as lead_name,'5500000000000' as lead_phone,'Empreendimento Teste' as project_name,123::bigint as lead_id,
  'Cliente aceitou agendar uma visita.' as qualification_reason
  where has_table_privilege(current_user,'private.qualified_whatsapp_alerts','SELECT,UPDATE');`;
const send=nodes.find(n=>n.name==='Evolution - Novo lead qualificado');
send.parameters.url=base+'/webhook/'+echoPath;send.parameters.headerParameters={parameters:[{name:'Content-Type',value:'application/json'}]};
delete send.credentials;delete send.parameters.authentication;delete send.parameters.nodeCredentialType;
const finish=nodes.find(n=>n.name==='Registrar resultado do alerta');
finish.parameters.query="select ($1::uuid is not null and $2::uuid is not null and $3::text='sent' and $4::text='qa-receipt' and $5::text is null) as recorded;";
const echo={id:crypto.randomUUID(),name:'Mock Evolution HTTP',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,400],webhookId:crypto.randomUUID(),parameters:{httpMethod:'POST',path:echoPath,responseMode:'lastNode',options:{}}};
const echoResult={id:crypto.randomUUID(),name:'Recibo sintético',type:'n8n-nodes-base.code',typeVersion:2,position:[260,400],parameters:{jsCode:"const body=$json.body;if(body.number!=='120363000000000000@g.us'||!body.text.includes('Novo lead qualificado')||!body.text.includes('Motivo: Cliente aceitou agendar uma visita.')||body.linkPreview!==false) throw new Error('Invalid mock request');return [{json:{key:{id:'qa-receipt',fromMe:true},status:'PENDING'}}];"}};
nodes.push(echo,echoResult);connections[echo.name]={main:[[{node:echoResult.name,type:'main',index:0}]]};
assert(send.parameters.jsonBody.includes('linkPreview:false'),'Link preview must be disabled');
assert(!JSON.stringify(nodes).includes('evolution.henaweb.com.br'));
assert(!JSON.stringify(send).includes('apikey'));
let qaId;
try{
  const w=await api('/workflows','POST',{name:'QA Alerta qualificado - SEM envio WhatsApp',nodes,connections,settings:{executionOrder:'v1'}});qaId=w.id;
  await api(`/workflows/${qaId}/activate`,'POST',{});
  const r=await fetch(base+'/webhook/'+testPath,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const data=await r.json();const item=Array.isArray(data)?data[0]:data;
  assert(r.ok&&item.status==='sent',`QA failed: ${JSON.stringify(data).slice(0,500)}`);
  console.log(JSON.stringify({passed:true,qaId,productionId,realWhatsAppMessages:0,checks:['database credential','item linking','HTTP JSON body','Evolution receipt','SQL parameters']}));
}finally{if(qaId){await api(`/workflows/${qaId}/deactivate`,'POST',{});console.log(JSON.stringify({qaDeactivated:qaId}));}}
