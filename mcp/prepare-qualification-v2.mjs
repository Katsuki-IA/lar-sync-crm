import fs from 'node:fs';
import assert from 'node:assert/strict';
import { qualificationGate, qualificationPrompt } from './qualification-v2.mjs';

const backup = 'mcp/backups/2026-09-18T15-02-31-419Z-antes_qualificacao_v2_envio_crm-7GKceKnRBzw5st11.json';
const previous = JSON.parse(fs.readFileSync(backup,'utf8'));
const workflow = structuredClone(previous);
const node = name => { const n=workflow.nodes.find(n=>n.name===name); assert(n, name); return n; };
const gate=node('5 interações');
gate.type='n8n-nodes-base.code'; gate.typeVersion=2;
gate.parameters={jsCode:`const qualificationGate = ${qualificationGate.toString()};\nreturn [{json:qualificationGate($('Start to agent message').first().json,$('Encontrar Cliente1').first().json,$input.first().json.mensagens),pairedItem:{item:0}}];`};
node('Limit3').parameters.maxItems=24;
node('If2').parameters.conditions.conditions=[{id:'qualification-signal-gate',leftValue:'={{ $json.avaliar_qualificacao === true }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}];
node('AI Agent').parameters.text=qualificationPrompt;
const tool=node('is lead qualificado?1');
tool.parameters.fieldsUi.fieldValues=[
  {fieldId:'qualificado',fieldValue:"={{ $fromAI('fieldValues0_Field_Value', 'Classificação: 0 pendente, 1 qualificado para corretor, 2 desqualificado. Somente 0, 1 ou 2.', 'number') }}"},
  {fieldId:'interesse_comercial',fieldValue:"={{ $fromAI('interesse_comercial', 'true para qualificado ou pendente com interesse comercial; false para desqualificado ou apenas curiosidade.', 'boolean') }}"},
  {fieldId:'qualificacao_motivo',fieldValue:"={{ $fromAI('motivo', 'Motivo curto com a evidência do cliente. Não reproduza dados pessoais sensíveis.', 'string').slice(0, 600) }}"},
  {fieldId:'qualificacao_message_id',fieldValue:"={{ String($('Start to agent message').first().json.DadosLead?.MessageId ?? '') }}"},
];
const sync=node('Sincroniza qualificação no Hub');
sync.parameters.query='select * from jsonb_to_record(public.crm_sync_lead_qualification($1::bigint,$2::bigint,$3::text)) as r(qualificacao smallint,interesse_comercial boolean,crm_lead_id bigint,tag_aplicada text,lead_hub_atualizado boolean);';
sync.parameters.options.queryReplacement="={{ [Number($('Start to agent message').first().json.Empresa_id), Number($('Encontrar Cliente1').first().json.id), String($('Start to agent message').first().json.DadosLead?.MessageId ?? '')] }}";
node('Classificação definida?').parameters.conditions.conditions[0].leftValue='={{ [1, 2].includes(Number($json.qualificacao)) && $json.lead_hub_atualizado === true }}';
// Pending commercial interest also needs field/tag synchronization; only final
// numeric states continue into legacy external CRM qualification branches.
workflow.connections.DadosCliente.main=[[{node:'Sincroniza qualificação no Hub',type:'main',index:0}]];
workflow.connections['Sincroniza qualificação no Hub'].main=[[{node:'Classificação definida?',type:'main',index:0}]];
workflow.connections['Classificação definida?'].main=[[{node:'CRM check3',type:'main',index:0}],[{node:'No Operation, do nothing',type:'main',index:0}]];
assert.equal(node('AI Agent').parameters.hasOutputParser,true);
assert.equal(node('AI Agent').parameters.needsFallback,previous.nodes.find(n=>n.name==='AI Agent').parameters.needsFallback);
const allowed=new Set(['5 interações','Limit3','If2','AI Agent','is lead qualificado?1','Sincroniza qualificação no Hub','Classificação definida?']);
for(const n of workflow.nodes) if(!allowed.has(n.name)) assert.deepEqual(n,previous.nodes.find(p=>p.id===n.id));
const names=new Set(workflow.nodes.map(n=>n.name));
assert.equal(names.size,workflow.nodes.length);
for(const groups of Object.values(workflow.connections)) for(const outputs of Object.values(groups)) for(const edges of outputs) for(const edge of edges) assert(names.has(edge.node));
const payload={name:workflow.name,nodes:workflow.nodes,connections:workflow.connections,settings:workflow.settings};
fs.writeFileSync('mcp/backups/qualification-v2-candidate.json',JSON.stringify(payload));
if(!process.argv.includes('--publish')) {
  console.log(JSON.stringify({validated:true,previousVersion:previous.versionId,nodes:workflow.nodes.length,changedNodes:[...allowed]}));
} else {
  const root=process.env.N8N_API_URL?.replace(/\/$/,''); const key=process.env.N8N_API_KEY;
  assert(root&&key,'n8n environment required');
  const headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'};
  async function read(){const r=await fetch(`${root}/api/v1/workflows/${previous.id}`,{headers});assert(r.ok,`GET ${r.status}`);return r.json();}
  const live=await read(); assert.equal(live.versionId,previous.versionId,'Live workflow changed; aborting'); assert(live.active);
  const r=await fetch(`${root}/api/v1/workflows/${previous.id}`,{method:'PUT',headers,body:JSON.stringify(payload)});
  assert(r.ok,`PUT ${r.status}: ${r.ok?'':(await r.text()).slice(0,200)}`);
  const verified=await read(); assert(verified.active);assert.equal(verified.nodes.find(n=>n.name==='AI Agent').parameters.text,qualificationPrompt);
  for(const name of allowed) assert.deepEqual(verified.nodes.find(n=>n.name===name).parameters,node(name).parameters);
  assert.equal(verified.activeVersionId,verified.versionId,'Saved version is not active');
  console.log(JSON.stringify({published:true,version:verified.versionId,active:verified.active,nodes:verified.nodes.length}));
}
