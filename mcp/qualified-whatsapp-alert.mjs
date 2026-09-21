// Pure helpers also embedded in the n8n Code nodes. No credentials here.
export const alertClaimQuery = `with claimed as materialized (
  select * from private.claim_qualified_whatsapp_alerts(10)
)
select c.*, reason.qualification_reason
from claimed c
join private.qualified_whatsapp_alerts alert on alert.id=c.alert_id
left join lateral (
  select nullif(btrim(a.metadata->>'reason'),'') as qualification_reason
  from public.crm_lead_activities a
  where a.lead_id=c.lead_id and a.tipo='tag_add'
    and a.descricao='Tag adicionada: Qualificado'
    and a.metadata->>'source'='qualification_v2'
    and a.created_at<=alert.created_at
  order by a.created_at desc,a.id desc limit 1
) reason on true;`;
export function prepareAlert(row) {
  if (!row.alert_id || !row.claim_token || !/^[0-9-]+@g\.us$/.test(row.group_id ?? '')) throw new Error('Invalid claimed alert');
  const clean = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160);
  const rawReason = String(row.qualification_reason ?? '').replace(/\s+/g, ' ').trim();
  const reason = rawReason.length > 220 ? rawReason.slice(0, 217).trimEnd() + '…' : rawReason;
  return {...row, number:row.group_id, text:[
    '🔥 Novo lead qualificado', '',
    `Lead: ${clean(row.lead_name) || 'Não informado'}`,
    `Número: ${clean(row.lead_phone) || 'Não informado'}`,
    `Empreendimento: ${clean(row.project_name) || 'Não informado'}`, '',
    `💡 Motivo: ${reason || 'Motivo não registrado no histórico de qualificação.'}`, '',
    '✅ Envio ao CRM confirmado.',
    `Hub: https://hub.katsuki.com.br/leads/${Number(row.lead_id)}`, '',
    'Qualificado por Katsuki IA',
  ].join('\n')};
}
export function classifyAlertResponse(response) {
  const status=Number(response?.statusCode ?? 0);
  const body=response?.body ?? response;
  const id=body?.key?.id;
  if(status>=200 && status<300 && typeof id==='string' && id && body?.key?.fromMe===true && body?.status!=='ERROR') {
    return {status:'sent',message_id:id,error:null};
  }
  // HTTP rejection is definite; timeout, 5xx, or success without receipt is ambiguous.
  if(status>=400 && status<500) return {status:'failed',message_id:null,error:`Evolution rejeitou o alerta (HTTP ${status}).`};
  return {status:'uncertain',message_id:null,error:`Sem confirmação inequívoca da Evolution (HTTP ${status || 'indisponível'}). Conferir antes de reenviar.`};
}
