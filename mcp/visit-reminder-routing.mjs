// Deterministic workflow protections. No prompt or classifier changes.
export const PRESERVED_REPLY = 'Sua visita continua agendada, e o atendimento permanece com o corretor responsável.';

export function preserveVisit(company, expectedId, scheduledStage, response) {
  if (Number(company) !== 19) return { preserve: false };
  const positive = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;
  if (!positive(expectedId) || !positive(scheduledStage)) throw Error('Visita: identidade ou etapa inválida');
  const rows = response?.leads;
  const matches = Array.isArray(rows) ? rows.filter(r => String(r.idlead ?? r.id) === String(expectedId)) : [];
  if (matches.length !== 1) throw Error('Visita: cadastro CV não confirmado; redistribuição bloqueada');
  const lead = matches[0];
  if (!positive(lead.situacao?.id)) throw Error('Visita: situação CV ausente; redistribuição bloqueada');
  const scheduled = Number(lead.situacao.id) === Number(scheduledStage);
  // Never redistribute a scheduled visit, including when the owner is temporarily absent.
  if (!scheduled) return { preserve: false };
  if (!positive(lead.corretor?.id)) throw Error('Visita agendada sem corretor identificado; redistribuição bloqueada para revisão');
  return { preserve: true, receipt: { provider: 'cv_crm', external_id: String(expectedId),
    preserved_existing_visit: true, external_confirmed: true, confirmation_source: 'existing_scheduled_visit_readback',
    broker_assignment_verified: true, broker_id: Number(lead.corretor.id), stage_id: Number(lead.situacao.id) } };
}

export const resolveReminderSql = `select a.id as appointment_id, a.id_empresa as company_id, l.id as lead_id,
 l.numero, l.conversation_key, coalesce(l.legacy_conversation_key,l.numero||l.id_empresa::text) as legacy_key,
 l.wa_identity_id,l.wa_user_id,l.wa_username,
 'Olá '||coalesce(l.nome,'Cliente')||', tudo bem? Gostaria de lembrar que temos uma visita marcada para amanhã no empreendimento '
 ||coalesce(nullif(e.nome,''),'de seu interesse')||' às '||to_char(a.time,'HH24"h"MI')||'. Confirma sua presença?' as reminder_text
from public.agendamento a
join public.lead l on l.id=a.id_lead and l.id_empresa=a.id_empresa
join public.credentials c on c.id_empresa=a.id_empresa
left join public.empreendimento e on e.id=a.id_empreendimento and e.id_empresa=a.id_empresa
where a.id=$1::bigint and a.deleted_at is null and l.numero=$2::text
 and c.whatsapp_business_id::text=$3::text
 and a.day::date=(clock_timestamp() at time zone 'America/Sao_Paulo')::date+1
 and to_char(a.time,'HH24"h"MI')=$4::text and coalesce(l.nome,'Cliente')=$5::text;`;

export const recordReminderSql = `with saved as (
 insert into private.ai_realtime_history(company_id,lead_id,event_key,role,body,occurred_at)
 select $1::bigint,$2::bigint,'visit-reminder:'||$3::text,'assistant',$4::text,clock_timestamp()
 where exists(select 1 from public.lead where id=$2::bigint and id_empresa=$1::bigint)
 and nullif(btrim($3::text),'') is not null and nullif(btrim($4::text),'') is not null
 on conflict(company_id,lead_id,event_key) do nothing returning *
), mirrored as (
 insert into public.n8n_chat_conversas(numero,message,time,type,id_empresa,telefone,
 conversation_key,legacy_conversation_key,wa_identity_id,wa_user_id,wa_username)
 select coalesce(l.legacy_conversation_key,l.numero||l.id_empresa::text),to_jsonb(s.body),s.occurred_at,'ai',
 l.id_empresa,l.numero,l.conversation_key,coalesce(l.legacy_conversation_key,l.numero||l.id_empresa::text),
 l.wa_identity_id,l.wa_user_id,l.wa_username from saved s
 join public.lead l on l.id=s.lead_id and l.id_empresa=s.company_id returning id
) select (select count(*) from saved) as recorded,(select count(*) from mirrored) as mirrored;`;

export const preserveReceiptSql = `with saved as (
 update private.broker_handoff_attempts set status='confirmed',receipt=$5::jsonb,confirmed_at=clock_timestamp()
 where service_execution_id=$1::text and company_id=$2::bigint and company_id=19
 and lead_id=$3::bigint and broker_execution_id=$4::text and status='pending'
 and $5::jsonb->>'preserved_existing_visit'='true'
 and $5::jsonb->>'confirmation_source'='existing_scheduled_visit_readback'
 and exists(select 1 from public.lead l where l.id=$3::bigint and l.id_empresa=$2::bigint
 and l.id_crm=$5::jsonb->>'external_id') returning lead_id
) select exists(select 1 from saved) as preserved_existing_visit;`;

const node = (w, name) => { const n=w.nodes.find(n=>n.name===name); if(!n) throw Error('Missing node '+name); return n; };
const edge = name => ({node:name,type:'main',index:0});
function add(w,name,type,parameters,credentials) {
  if(w.nodes.some(n=>n.name===name)) throw Error('Already patched: '+name);
  w.nodes.push({id:'visit-fix-'+name.normalize('NFD').replace(/[^a-zA-Z0-9]/g,'-'),name,type,
    typeVersion:type.endsWith('.postgres')?2.6:type.endsWith('.if')?2.2:2,position:[900,900],parameters,...(credentials?{credentials}:{})});
}
function condition(w,name,expression,yes,no) {
  add(w,name,'n8n-nodes-base.if',{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},
    conditions:[{id:'visit-condition',leftValue:expression,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
  w.connections[name]={main:[[edge(yes)],[edge(no)]]};
}

export function patchReminder(original) {
  const w=structuredClone(original), creds=node(w,'Postgres Chat Memory1').credentials;
  const sql=(name,query,replacement)=>add(w,name,'n8n-nodes-base.postgres',{operation:'executeQuery',query,options:{queryReplacement:replacement}},creds);
  sql('Lembrete - Resolver conversa',resolveReminderSql,"={{ [Number($('Dados').first().json.id),String($('Dados').first().json.numero),String($('Dados').first().json.whatsapp_id),String($('Dados').first().json.hora_formatada),String($('Dados').first().json.nome)] }}");
  node(w,'Envia Aviso Agendamento').parameters.url="=https://graph.facebook.com/v18.0/{{ $('Dados').first().json.whatsapp_id }}/messages";
  node(w,'Envia Aviso Agendamento').parameters.headerParameters.parameters.find(p=>p.name==='Authorization').value="=Bearer {{ $('Dados').first().json.whatsapp_token }}";
  add(w,'Lembrete - Validar aceite Meta','n8n-nodes-base.code',{jsCode:"const id=$json.messages?.[0]?.id; if(typeof id!=='string'||!id.trim()) throw Error('Lembrete não aceito pela Meta; histórico não registrado'); return [{json:{meta_message_id:id}}];"});
  sql('Lembrete - Registrar no histórico',recordReminderSql,"={{ [Number($('Lembrete - Resolver conversa').first().json.company_id),Number($('Lembrete - Resolver conversa').first().json.lead_id),$json.meta_message_id,$('Lembrete - Resolver conversa').first().json.reminder_text] }}");
  w.connections.Dados={main:[[edge('Lembrete - Resolver conversa')]]};
  w.connections['Lembrete - Resolver conversa']={main:[[edge('Envia Aviso Agendamento')]]};
  w.connections['Envia Aviso Agendamento']={main:[[edge('Lembrete - Validar aceite Meta')]]};
  w.connections['Lembrete - Validar aceite Meta']={main:[[edge('Lembrete - Registrar no histórico')]]};
  w.nodes=w.nodes.filter(n=>!['Chat Memory Manager','Postgres Chat Memory1'].includes(n.name));
  delete w.connections['Postgres Chat Memory1']; delete w.connections['Chat Memory Manager'];
  return w;
}

export function patchBroker(original) {
  const w=structuredClone(original), creds=node(w,'Get Lead').credentials;
  const sql=(name,query,replacement)=>add(w,name,'n8n-nodes-base.postgres',{operation:'executeQuery',query,options:{queryReplacement:replacement}},creds);
  const fallback='Corretor - Reutilizar qualificado enviado';
  condition(w,'AR - Verificar visita antes do repasse',"={{ Number($('Start').first().json.id_empresa) === 19 }}",'AR - Contexto visita',fallback);
  w.connections['Corretor - Validar mensagem antes do repasse']={main:[[edge('AR - Verificar visita antes do repasse')]]};
  sql('AR - Contexto visita',`select l.id,l.id_crm,l.numero,s.scheduled,c.cv_crm_url,c.cv_crm_token,c.cv_crm_email
from public.lead l join public.credentials c on c.id_empresa=l.id_empresa
join public.steps_cv_crm s on s.id_empresa=l.id_empresa
where l.id=$1::bigint and l.id_empresa=$2::bigint and l.id_empresa=19;`,"={{ [Number($('Start').first().json.lead_id),Number($('Start').first().json.id_empresa)] }}");
  const request=structuredClone(node(w,'Get Lead CV'));
  request.name='AR - Consultar visita no CV'; request.id='visit-fix-ar-readback';
  request.parameters=JSON.parse(JSON.stringify(request.parameters).replaceAll('Get Credentials','AR - Contexto visita'));
  request.parameters.queryParameters.parameters=[{name:'telefone',value:"={{ $('AR - Contexto visita').first().json.numero }}"}];
  w.nodes.push(request);
  add(w,'AR - Avaliar visita existente','n8n-nodes-base.code',{jsCode:`const decide=${preserveVisit.toString()}; const ctx=$('AR - Contexto visita').first().json; return [{json:decide(19,ctx.id_crm,ctx.scheduled,$json)}];`});
  condition(w,'AR - Preservar visita?',"={{ $json.preserve === true }}",'AR - Registrar preservação',fallback);
  sql('AR - Registrar preservação',preserveReceiptSql,"={{ [String($('Start').first().json.service_execution_id || $execution.id),Number($('Start').first().json.id_empresa),Number($('Start').first().json.lead_id),String($execution.id),JSON.stringify($('AR - Avaliar visita existente').first().json.receipt)] }}");
  add(w,'AR - Resultado visita preservada','n8n-nodes-base.code',{jsCode:`if($json.preserved_existing_visit!==true)throw Error('Não foi possível registrar preservação da visita'); return [{json:{preserved_existing_visit:true,redistributed:false,stage_changed:false,instruction:'A visita e o corretor já estavam definidos. Não houve novo encaminhamento. Informe que a visita continua agendada e que o atendimento permanece com o corretor responsável.'}}];`});
  for(const [a,b] of [['AR - Contexto visita','AR - Consultar visita no CV'],['AR - Consultar visita no CV','AR - Avaliar visita existente'],['AR - Avaliar visita existente','AR - Preservar visita?'],['AR - Registrar preservação','AR - Resultado visita preservada']]) w.connections[a]={main:[[edge(b)]]};
  return w;
}

export function patchService(original) {
  const w=structuredClone(original), check=node(w,'Corretor - Conferir confirmação atual');
  check.parameters.query=`select $5::jsonb as response,
 private.broker_handoff_proof($1::text,$2::bigint,$3::bigint,$4::text) || jsonb_build_object(
 'preserved_existing_visit',exists(select 1 from private.broker_handoff_attempts a
 where a.service_execution_id=$1::text and a.company_id=$2::bigint and a.company_id=19
 and a.lead_id=$3::bigint and a.message_id=$4::text and a.status='confirmed' and a.confirmed_at is not null
 and a.receipt->>'preserved_existing_visit'='true'
 and a.receipt->>'confirmation_source'='existing_scheduled_visit_readback')) as handoff_proof`;
  const gate=node(w,'Corretor - Liberar resposta validada');
  const anchor='// Only the database can provide proof. Never trust model text/tool observations.';
  if(!gate.parameters.jsCode.includes(anchor))throw Error('Service gate changed; review before patching');
  gate.parameters.jsCode=gate.parameters.jsCode.replace(anchor,anchor+`\n  if(proof?.confirmed===true && proof?.preserved_existing_visit===true) return {...result,output:${JSON.stringify(PRESERVED_REPLY)},broker_handoff_blocked:false,preserved_existing_visit:true};`);
  return w;
}
