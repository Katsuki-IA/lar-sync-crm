export function resolveCvVisitProject(start, agenda) {
  const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
  const company=start?.Empresa?.id;
  const selected=agenda?.empreendimento_id;
  if(!positive(company)||!positive(selected))throw Error('CV: empresa ou empreendimento da visita inválido');
  const matches=(Array.isArray(start.Empreendimentos)?start.Empreendimentos:[])
    .filter(e=>String(e.id)===String(selected));
  if(matches.length!==1)throw Error('CV: empreendimento da visita ausente ou ambíguo; envio bloqueado');
  const project=matches[0];
  if(project.id_empresa!=null&&Number(project.id_empresa)!==Number(company))throw Error('CV: empreendimento de outra empresa');
  if(!positive(project.cv_id_empreendimento))throw Error('CV: empreendimento da visita sem mapeamento externo');
  return Number(project.cv_id_empreendimento);
}

export function patchCvVisitProject(original){
  const w=structuredClone(original);
  const wrong="$('Start schedule').item.json.Empreendimentos[0].cv_id_empreendimento";
  const replacement=`(${resolveCvVisitProject.toString()})($('Start schedule').first().json,$('dados agenda').first().json)`;
  for(const name of ['Atualiza estagio e salva resumo','Atualiza estagio']){
    const n=w.nodes.find(n=>n.name===name);
    if(!n?.parameters?.jsonBody?.includes(wrong))throw Error('CV: nó mudou; revisar '+name);
    n.parameters.jsonBody=n.parameters.jsonBody.replace(wrong,replacement);
  }
  return w;
}
