export function configureModanQueue(workflow) {
  const changes = {
    'K6Ra0NieeLWEFi1w': {
      node: 'Enviar CV externo pelo Hub', field: 'jsonBody',
      before: ` if(Number.isSafeInteger(project)`,
      after: ` if(idEmpresa===41) {
   payload.cvDistributionQueueId=4;
   payload.additionalTags.push('ativacao-modan');
 }
 if(Number.isSafeInteger(project)`,
    },
    'MGQIt0gFo3WMz9rG': {
      node: 'Montar ação final', field: 'jsCode',
      before: `if (queueId != null) cvBody.idfila_distribuicao_leads = queueId;`,
      after: `if (queueId != null) cvBody.idfila_distribuicao_leads = queueId;
if (isCv && Number(c.id_empresa) === 41 && queueId != null) {
  if (!tags.includes('ativacao-modan')) tags.push('ativacao-modan');
  cvBody.lead_utilizar_fila = true;
}`,
    },
    'p29aThJ6hVtuqIWf': {
      node: 'Validar cadastro CV', field: 'jsCode',
      before: `    forcar_distribuicao_lead:true,`,
      after: `    forcar_distribuicao_lead:true,
    ...(Number(context.id_empresa) === 41 ? {
      lead_utilizar_fila:true,
      tags:[...new Set([...(Array.isArray(lead.tags) ? lead.tags : []).map(tag => typeof tag === 'string' ? tag : tag?.nome ?? tag?.name).filter(Boolean), 'ativacao-modan'])],
    } : {}),`,
    },
  };
  const change = changes[workflow.id];
  if (!change) throw new Error('Fluxo desconhecido');
  const params = workflow.nodes.find(node => node.name === change.node)?.parameters;
  const source = params?.[change.field];
  if (source?.includes(change.after)) return workflow;
  if (!source?.includes(change.before)) throw new Error('Definição do fluxo mudou');
  params[change.field] = source.replace(change.before, change.after);
  return workflow;
}
