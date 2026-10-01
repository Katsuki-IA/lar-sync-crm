import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

export function validateRouting(context) {
  const routing=context?.routing;
  if(!routing || !['venda','locacao'].includes(routing.tipo_negociacao)) throw new Error('C2S: defina venda ou locação antes de encaminhar o lead.');
  if(!Number.isSafeInteger(Number(routing.fila_id)) || Number(routing.fila_id)<=0) throw new Error('C2S: fila não configurada para esta modalidade.');
  return context;
}

export function buildNegotiationWorkflow(original) {
  const w=structuredClone(original);
  const get=name=>{const n=w.nodes.find(n=>n.name===name);assert(n,name);return n;};
  const edge=node=>({node,type:'main',index:0});
  const pg=get('Resolve Identidade C2S');
  const add=(name,type,parameters,position,credentials)=>w.nodes.push({id:randomUUID(),name,type,typeVersion:type.endsWith('postgres')?2.6:2,parameters,position,...(credentials?{credentials}: {})});
  add('Resolve Roteamento C2S','n8n-nodes-base.postgres',{
    operation:'executeQuery',
    query:"select $1::jsonb || jsonb_build_object('routing',public.crm_resolve_c2s_routing(($1::jsonb->>'id_empresa')::bigint,($1::jsonb->>'hub_lead_id')::bigint,($1::jsonb->>'legacy_lead_id')::bigint,null)) as contexto;",
    options:{queryReplacement:'={{ [JSON.stringify($json)] }}'},
  },[pg.position[0]+180,pg.position[1]+200],pg.credentials);
  add('Valida Roteamento C2S','n8n-nodes-base.code',{jsCode:`const validate=${validateRouting.toString()}; return [{json:validate($input.first().json.contexto)}];`},[pg.position[0]+380,pg.position[1]+200]);
  w.connections['Resolve Identidade C2S']={main:[[edge('Resolve Roteamento C2S')]]};
  w.connections['Resolve Roteamento C2S']={main:[[edge('Valida Roteamento C2S')]]};
  w.connections['Valida Roteamento C2S']={main:[[edge('Reserva Criacao C2S')]]};
  const create=get('Cria Lead C2S');
  create.parameters.jsonBody=create.parameters.jsonBody.replace("attributes.external_id =", "attributes.type_negotiation = $('Valida Roteamento C2S').first().json.routing.type_negotiation;\n  attributes.external_id =");
  get('Redistribui Lead C2S').parameters.url="={{ String($('Get Credentials').first().json.c2s_crm_url || '').replace(/\\/+$/, '') + '/distribution_queues/' + $('Valida Roteamento C2S').first().json.routing.fila_id + '/redistribute_lead' }}";
  get('Redistribui Lead C2S').parameters.jsonBody="={{ {id: $json.c2s_lead_id} }}";
  get('Salva Vinculo C2S').parameters.query=get('Salva Vinculo C2S').parameters.query.replace("status='sent'","status='pending'");
  w.connections['Salva Vinculo C2S']={main:[[edge('Redistribui Lead C2S')]]};
  get('Confirma Redistribuicao C2S').parameters.jsCode=`const response=$input.first().json;
const original=$('Valida Contexto C2S').first().json;
const expected=original.action==='create' ? $('Confirma Criacao C2S').first().json.c2s_lead_id : original.c2s_lead_id;
if(response.success!==true || String(response.lead_id||'')!==String(expected)) throw new Error('C2S: distribuição não confirmada para o lead solicitado.');
return [{json:{...original,c2s_lead_id:expected,c2s_response:response}}];`;
  add('Confirma Fila C2S no Registro','n8n-nodes-base.postgres',{
    operation:'executeQuery',query:`with updated as (
      update public.crm_external_crm_send_logs set status='sent',
        request_payload=request_payload||jsonb_build_object('tipo_negociacao',$3::text,'distribution_queue_id',$4::bigint),
        response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('redistribute_lead',$5::jsonb)
      where id=$2::uuid and external_id=$1::text and status='pending' and id_empresa=$6::bigint
        and provider='c2s' and request_payload->>'source'='n8n_mover_corretor'
      returning id
    ) select $1::text c2s_lead_id,not $7::boolean or exists(select 1 from updated) as fila_registrada;`,
    options:{queryReplacement:"={{ [$json.c2s_lead_id,$json.log_id || null,$('Valida Roteamento C2S').first().json.routing.tipo_negociacao,Number($('Valida Roteamento C2S').first().json.routing.fila_id),JSON.stringify($json.c2s_response),Number($json.id_empresa),$json.action === 'create'] }}"},
  },[pg.position[0]+780,pg.position[1]+400],pg.credentials);
  add('Valida Registro Fila C2S','n8n-nodes-base.code',{jsCode:"if($json.fila_registrada!==true) throw new Error('C2S: fila confirmada sem vínculo persistido; revisar antes de repetir.'); return $input.all();"},[pg.position[0]+980,pg.position[1]+400]);
  w.connections['Confirma Redistribuicao C2S']={main:[[edge('Confirma Fila C2S no Registro')]]};
  w.connections['Confirma Fila C2S no Registro']={main:[[edge('Valida Registro Fila C2S')]]};
  w.connections['Valida Registro Fila C2S']={main:[[edge('Registra Mensagem C2S')]]};
  return w;
}

export function buildNegotiationSchedule(original) {
  const w=structuredClone(original);
  const target=w.nodes.find(n=>n.name==='Redistribuir na Fila');
  assert(target,'Redistribuir na Fila');
  const pg=w.nodes.find(n=>n.name==='C2S Hub - dados da visita');
  const resolve='Resolve Fila Visita C2S';
  const validate='Valida Fila Visita C2S';
  const edge=node=>({node,type:'main',index:0});
  for(const outputs of Object.values(w.connections)) for(const branch of outputs.main||[]) for(const connection of branch) {
    if(connection.node===target.name) connection.node=resolve;
  }
  w.nodes.push({id:randomUUID(),name:resolve,type:'n8n-nodes-base.postgres',typeVersion:2.6,credentials:pg.credentials,position:[target.position[0]-400,target.position[1]+200],parameters:{
    operation:'executeQuery',query:'select public.crm_resolve_c2s_routing($1::bigint,null,$2::bigint,$3::bigint) routing;',
    options:{queryReplacement:"={{ (() => {const s=$('Start schedule').first().json; const id=Number(s.Lead?.id);const project=Number($('dados agenda').first().json.empreendimento_id || s.Lead?.empreendimento_em_foco_id || s.Lead?.id_empreendimento);return [Number(s.Empresa_id),Number.isSafeInteger(id)&&id>0?id:null,Number.isSafeInteger(project)&&project>0?project:null];})() }}"},
  }});
  w.nodes.push({id:randomUUID(),name:validate,type:'n8n-nodes-base.code',typeVersion:2,position:[target.position[0]-200,target.position[1]+200],parameters:{jsCode:`const validate=${validateRouting.toString()}; const result=validate($input.first().json);const id=String($('Start schedule').first().json.Lead?.id_crm||'');if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('C2S: ID externo ausente');return [{json:{...result,c2s_lead_id:id}}];`}});
  w.connections[resolve]={main:[[edge(validate)]]};
  w.connections[validate]={main:[[edge(target.name)]]};
  target.parameters.url="={{ String($('Start schedule').first().json.Credentials.c2s_crm_url || '').replace(/\\/+$/, '') + '/distribution_queues/' + $('Valida Fila Visita C2S').first().json.routing.fila_id + '/redistribute_lead' }}";
  target.parameters.specifyBody='json';
  target.parameters.jsonBody="={{ {id:$('Valida Fila Visita C2S').first().json.c2s_lead_id} }}";
  delete target.parameters.bodyParameters;
  const confirm='Confirma Fila Visita C2S';
  w.nodes.push({id:randomUUID(),name:confirm,type:'n8n-nodes-base.code',typeVersion:2,position:[target.position[0]+200,target.position[1]],parameters:{jsCode:"const response=$input.first().json;const id=$('Valida Fila Visita C2S').first().json.c2s_lead_id;if(response.success!==true || String(response.lead_id||'')!==id)throw new Error('C2S: fila da visita não confirmada');return $input.all();"}});
  w.connections[confirm]=w.connections[target.name]||{main:[[]]};
  w.connections[target.name]={main:[[edge(confirm)]]};
  // Hub dispatch now confirms the selected queue before returning success.
  // This old node incorrectly used the lead ID as a queue ID and would redistribute twice.
  const obsolete='C2S Hub - redistribuir';
  w.nodes=w.nodes.filter(n=>n.name!==obsolete);
  delete w.connections[obsolete];
  for(const outputs of Object.values(w.connections)) for(const branch of outputs.main||[]) {
    for(let i=branch.length-1;i>=0;i--) if(branch[i].node===obsolete) branch.splice(i,1);
  }
  return w;
}
