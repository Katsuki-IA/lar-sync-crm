import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { qualificationPrompt } from './qualification-v2.mjs';
const source=JSON.parse(fs.readFileSync('mcp/backups/2026-09-18T15-02-31-419Z-antes_qualificacao_v2_envio_crm-7GKceKnRBzw5st11.json'));
const root=process.env.N8N_API_URL?.replace(/\/$/,''); const key=process.env.N8N_API_KEY;
assert(root&&key);
const headers={'X-N8N-API-KEY':key,'Content-Type':'application/json'};
async function api(path,method='GET',body){const r=await fetch(root+'/api/v1'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();assert(r.ok,`${method} ${path}: ${r.status} ${t.slice(0,500)}`);return t?JSON.parse(t):{};}
const mk=(name,type,parameters,version=2)=>({id:crypto.randomUUID(),name,type,typeVersion:version,position:[0,0],parameters});
const path='qa-qualification-'+crypto.randomUUID();
const hook=mk('QA Hook','n8n-nodes-base.webhook',{httpMethod:'POST',path,responseMode:'lastNode',options:{}},2);hook.webhookId=crypto.randomUUID();
const start=mk('Start to agent message','n8n-nodes-base.code',{jsCode:'return [{json:$input.first().json.body}];'});
const lead=mk('Encontrar Cliente1','n8n-nodes-base.code',{jsCode:"return [{json:{id:-1,qualificado:$('Start to agent message').first().json.previous??0}}];"});
const input=mk('Contexto QA','n8n-nodes-base.code',{jsCode:"return [{json:{mensagens:JSON.stringify($('Start to agent message').first().json.history??[])}}];"});
const agent=structuredClone(source.nodes.find(n=>n.name==='AI Agent'));agent.parameters.text=qualificationPrompt;agent.parameters.options.returnIntermediateSteps=true;delete agent.onError;
const sync=source.nodes.find(n=>n.name==='Sincroniza qualificação no Hub');
const mock=mk('is lead qualificado?1','n8n-nodes-base.postgresTool',{
  descriptionType:'manual',toolDescription:'Registra a classificação 0/1/2, interesse comercial e motivo (teste sem gravação).',
  operation:'executeQuery',query:'select $1::smallint as qualificado, $2::boolean as interesse_comercial, $3::text as motivo',
  options:{queryReplacement:"={{ [$fromAI('fieldValues0_Field_Value','Classificação 0, 1 ou 2','number'), $fromAI('interesse_comercial','Interesse comercial verdadeiro ou falso','boolean'), $fromAI('motivo','Motivo curto','string')] }}"},
},2.6);mock.credentials=structuredClone(sync.credentials);
const subNames=['Model','DeepSeek Chat Model1','Saída estrita 0 1 ou 2'];
const nodes=[hook,start,lead,input,agent,mock,...source.nodes.filter(n=>subNames.includes(n.name)).map(n=>structuredClone(n))];
const edge=name=>({main:[[{node:name,type:'main',index:0}]]});
const connections={'QA Hook':edge(start.name),[start.name]:edge(lead.name),[lead.name]:edge(input.name),[input.name]:edge(agent.name),[mock.name]:source.connections[mock.name]};
for(const name of subNames)connections[name]=source.connections[name];
let id;
try {
  const created=await api('/workflows','POST',{name:'QA Qualificação v2 — sintético sem gravação',nodes,connections,settings:{executionOrder:'v1'}});id=created.id;
  fs.writeFileSync('mcp/backups/qualification-v2-qa-id.json',JSON.stringify({id}));
  await api(`/workflows/${id}/activate`,'POST',{});
  const cases=[
    {name:'price_only',Mensagem:'Qual o preço e quanto de entrada?',expected:0,interest:true},
    {name:'visit_first_message',Mensagem:'Quero agendar uma visita amanhã.',expected:1,interest:true},
    {name:'wrong_person',Mensagem:'Pessoa errada, não fui eu quem pediu isso.',expected:2,interest:false},
    {name:'unknown_project',Mensagem:'Não conheço esse empreendimento, o que é DUE?',expected:0,interest:false},
    {name:'reject_after_qualified',Mensagem:'Para mim não dá, procuro somente até 300 mil e não vou seguir com essa opção.',previous:1,history:[{role:'user',text:'Quero visitar'}],expected:2,interest:false},
    {name:'short_visit_acceptance',Mensagem:'Bom dia pode claro',history:[{role:'assistant',text:'Podemos agendar uma visita?'}],expected:1,interest:true},
  ];
  for(const c of cases){
    const r=await fetch(root+'/webhook/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});
    const t=await r.text();let data;try{data=JSON.parse(t);}catch{data={raw:t.slice(0,400)}}
    const item=Array.isArray(data)?data[0]:data;
    console.log(JSON.stringify({case:c.name,status:r.status,result:item}));
    assert(r.ok && Number(item.output)===c.expected,`${c.name}: invalid output`);
    const steps=item.intermediateSteps??[];
    const calls=steps.filter(s=>s.action?.tool?.includes('is_lead')||s.action?.tool?.includes('qualificado'));
    assert(calls.length===1,`${c.name}: tool call count ${calls.length}`);
    const inp=calls[0].action.toolInput;
    assert.equal(Number(inp.fieldValues0_Field_Value),c.expected);
    assert.equal(inp.interesse_comercial,c.interest);
  }
  console.log(JSON.stringify({allPassed:true,workflowId:id,cases:cases.length}));
} finally {if(id){await api(`/workflows/${id}/deactivate`,'POST',{});console.log(JSON.stringify({qaDeactivated:id}));}}
