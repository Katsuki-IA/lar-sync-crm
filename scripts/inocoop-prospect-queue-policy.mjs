export function omitProspectQueueOverrides(workflow) {
  const fields = ['utilizar_fila_gestor', 'utilizar_fila_corretor', 'lead_utilizar_fila'];
  for (const node of workflow.nodes.filter(node => node.name.startsWith('Prospecção 41 - '))) {
    for (const key of ['jsCode', 'jsonBody']) {
      if (typeof node.parameters[key] !== 'string') continue;
      for (const field of fields) node.parameters[key] = node.parameters[key].replaceAll(field + ':false,', '');
    }
  }
  return workflow;
}
