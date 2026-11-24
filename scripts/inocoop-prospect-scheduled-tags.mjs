export function applyModanVisitTags(workflow) {
  const dispatch = workflow.nodes.find(node => node.name === 'HTTP Request').parameters;
  const tags = 'additionalTags: ["Visita Agendada IA"]';
  if (!dispatch.jsonBody.includes(tags)) throw new Error('Formato do envio mudou');
  dispatch.jsonBody = dispatch.jsonBody.replace(tags, 'additionalTags: Number($("Start schedule").item.json.Empresa_id) === 41 ? ["Visita Agendada IA", "ativacao-modan"] : ["Visita Agendada IA"]');
  const hub = workflow.nodes.find(node => node.name === 'Grava Msg Lead HUB1').parameters;
  const stage = '$4::bigint as target_stage_id';
  if (!hub.query.includes(stage)) throw new Error('Mapeamento da etapa mudou');
  hub.query = hub.query.replace(stage, "case when $1::bigint=41 then (select id from public.crm_stages where id_empresa=41 and id=224 and nome='Visita Agendada' and ativo) else $4::bigint end as target_stage_id");
  return workflow;
}
