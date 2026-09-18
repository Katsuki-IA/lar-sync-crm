// Pure helpers also embedded in the n8n Code nodes. No credentials here.
export function prepareAlert(row) {
  if (!row.alert_id || !row.claim_token || !/^[0-9-]+@g\.us$/.test(row.group_id ?? '')) throw new Error('Invalid claimed alert');
  const clean = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160);
  return {...row, number:row.group_id, text:[
    '🔥 Novo lead qualificado', '',
    `Lead: ${clean(row.lead_name) || 'Não informado'}`,
    `Número: ${clean(row.lead_phone) || 'Não informado'}`,
    `Empreendimento: ${clean(row.project_name) || 'Não informado'}`, '',
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
