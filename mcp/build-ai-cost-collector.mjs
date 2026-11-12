import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizeExecution } from './ai-cost-normalize.mjs';

export function buildCollector({baseUrl,credentialId,postgresCredentialId='WyPVUxmqPcUYXxCq'}) {
  const nodes=[],connections={};
  const add=(name,type,parameters,x,y,extra={})=>{nodes.push({id:randomUUID(),name,type,typeVersion:type==='n8n-nodes-base.postgres'?2.6:type==='n8n-nodes-base.httpRequest'?4.2:type==='n8n-nodes-base.code'?2:1.2,position:[x,y],parameters,...extra});return name;};
  const connect=(a,b)=>{(connections[a]??={main:[[]]}).main[0].push({node:b,type:'main',index:0});};
  const pg=(name,query,replacement,x,y)=>add(name,'n8n-nodes-base.postgres',{operation:'executeQuery',query,options:{queryReplacement:replacement}},x,y,{credentials:{postgres:{id:postgresCredentialId,name:'Supabase-unico'}},retryOnFail:true,maxTries:3,waitBetweenTries:2000});
  const http=(name,url,options,x,y)=>add(name,'n8n-nodes-base.httpRequest',{url,authentication:'predefinedCredentialType',nodeCredentialType:'n8nApi',options:{timeout:60000,...options}},x,y,{credentials:{n8nApi:{id:credentialId,name:'AI Costs - n8n API'}},retryOnFail:true,maxTries:3,waitBetweenTries:2000});
  add('A cada minuto','n8n-nodes-base.scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:1}]}},0,0);
  pg('Próxima fonte',`select workflow_id from public.ai_cost_sources where enabled and (last_scan_at is null or last_scan_at<now()-interval '5 minutes') order by last_scan_at nulls first,workflow_id limit 1;`,'',220,-180);
  const listUrl=baseUrl.replace(/\/$/,'')+'/api/v1/executions';
  http('Listar execuções',`=${listUrl}?limit=250&workflowId={{ $json.workflow_id }}`,{pagination:{pagination:{paginationMode:'responseContainsNextURL',nextURL:`={{ ${JSON.stringify(listUrl+'?limit=250&workflowId=')} + $('Próxima fonte').first().json.workflow_id + '&cursor=' + encodeURIComponent($response.body.nextCursor) }}`,paginationCompleteWhen:'other',completeExpression:'={{ !$response.body.nextCursor }}',requestInterval:200}}},440,-180);
  add('Preparar inventário','n8n-nodes-base.code',{jsCode:`const records=$input.all().flatMap(i=>i.json.data||[]).filter(e=>['success','error','canceled','crashed'].includes(e.status)&&e.startedAt).map(e=>({execution_id:String(e.id),workflow_id:String(e.workflowId),started_at:e.startedAt}));return [{json:{workflow_id:$('Próxima fonte').first().json.workflow_id,records}}];`},660,-180);
  pg('Enfileirar execuções',`with inserted as (insert into public.ai_cost_execution_queue(execution_id,workflow_id,started_at) select execution_id,workflow_id,started_at from jsonb_to_recordset($1::jsonb) x(execution_id text,workflow_id text,started_at timestamptz) on conflict do nothing returning execution_id) update public.ai_cost_sources set last_scan_at=now() where workflow_id=$2 returning workflow_id,(select count(*) from inserted) as queued;`,'={{ [JSON.stringify($json.records),$json.workflow_id] }}',880,-180);
  pg('Reservar pendências',`with selected as (select execution_id from public.ai_cost_execution_queue where status='pending' or (status='processing' and lease_until<now()) order by (started_at>=now()-interval '1 hour') desc,started_at,execution_id for update skip locked limit 50) update public.ai_cost_execution_queue q set status='processing',lease_until=now()+interval '10 minutes',attempts=attempts+1 from selected s where s.execution_id=q.execution_id returning q.execution_id,q.workflow_id;`,'',220,180);
  http('Ler execução',`=${listUrl}/{{ $json.execution_id }}?includeData=true`,{response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}},batching:{batch:{batchSize:1,batchInterval:100}}},440,180);
  add('Extrair consumo','n8n-nodes-base.code',{mode:'runOnceForEachItem',jsCode:`${normalizeExecution.toString()}\nconst queue=$('Reservar pendências').item.json; const response=$json; if(response.statusCode!==200) return {json:{execution_id:queue.execution_id,workflow_id:queue.workflow_id,error:response.statusCode===404?'unavailable':'http_'+response.statusCode}}; try {return {json:normalizeExecution(response.body)}} catch {return {json:{execution_id:queue.execution_id,workflow_id:queue.workflow_id,error:'execution_data_missing'}}}`},660,180);
  pg('Gravar consumo',`with failed as (update public.ai_cost_execution_queue set status=case when $1::jsonb->>'error'='unavailable' then 'unavailable' else 'processing' end,last_error=$1::jsonb->>'error',lease_until=now()+interval '10 minutes' where execution_id=$1::jsonb->>'execution_id' and ($1::jsonb->>'error') is not null returning execution_id) select case when ($1::jsonb->>'error') is null then public.ai_cost_record_execution($1::jsonb) else 0 end as inserted;`,'={{ [JSON.stringify($json)] }}',880,180);
  connect('A cada minuto','Próxima fonte');connect('A cada minuto','Reservar pendências');
  for(const chain of [['Próxima fonte','Listar execuções','Preparar inventário','Enfileirar execuções'],['Reservar pendências','Ler execução','Extrair consumo','Gravar consumo']])for(let i=1;i<chain.length;i++)connect(chain[i-1],chain[i]);
  return {name:'Custos IA - Coleta por empresa',nodes,connections,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,executionTimeout:600,timezone:'America/Sao_Paulo'}};
}
if(process.argv[1]?.endsWith('build-ai-cost-collector.mjs')) {
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 fs.writeFileSync(process.argv[3],JSON.stringify(buildCollector(config),null,2));
}
