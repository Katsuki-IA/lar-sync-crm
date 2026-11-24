import assert from 'node:assert/strict';

const leadId = "$('Recarrega Lead').first().json.visit_development_id";
const pinnedId = "$('Start schedule').first().json.Lead?.visit_development_id";

function params(workflow, name) {
  const node = workflow.nodes.find(n => n.name === name);
  assert(node, name);
  return node.parameters;
}

function change(text, anchor, replacement) {
  const result = text.replace(anchor, () => replacement);
  assert.notEqual(result, text, 'Workflow no longer matches ' + anchor);
  return result;
}

// Without an explicit focus, use a sole company development only if the
// registered development is absent or agrees with it.
export const resolution = `(
  select case
    when l.empreendimento_em_foco_id is not null then
      max(e.id) filter (where e.id = l.empreendimento_em_foco_id)
    when count(*) = 1 and
      (l.id_empreendimento is null or min(e.id) = l.id_empreendimento)
      then min(e.id)
  end
  from public.empreendimento e where e.id_empresa = l.id_empresa
)`;

export function patchService(w) {
  const reload = params(w, 'Recarrega Lead');
  reload.query = change(reload.query, 'select l.*\nfrom target',
    'select l.*, ' + resolution + ' as visit_development_id\nfrom target');
  for (const name of ['Visitas ativas do lead', 'Disponibilidade de visitas', 'Consultar Horários', 'Pego agendamentos']) {
    const options = params(w, name).options;
    options.queryReplacement = change(options.queryReplacement,
      "Number($('Recarrega Lead').first().json.empreendimento_em_foco_id || 0)", leadId);
  }
  const tool = params(w, 'Consultar Horários');
  tool.query = change(tool.query, 'select public.', 'select case when $2::bigint is null then \'[]\'::jsonb else public.');
  tool.query = change(tool.query, ') as available_slots', ') end as available_slots');
  const validator = params(w, 'Retorna Data válida');
  validator.jsCode = change(validator.jsCode, / const focusEmps=[^\n]+\n const focusLead=[^\n]+\n const focus=[^\n]+/,
    ' const focus=Number(' + leadId + ');');
  validator.jsCode = change(validator.jsCode, /const empreendimentosEmpresa = [^\n]+\nconst unicoEmpreendimentoId = [^\n]+\nconst focoLead = [^\n]+\nconst focoId = [^\n]+/,
    'const focoId = Number(' + leadId + ');');
  const prompt = params(w, 'AI Agent agendamento').options;
  prompt.systemMessage = change(prompt.systemMessage, 'lead.empreendimento_em_foco_id||lead.id_empreendimento', 'lead.visit_development_id');
  const inputs = params(w, "Call 'Service Agent -> Schedule'").workflowInputs.value;
  inputs.Lead = change(inputs.Lead, "$('Grava Timestamp Msg').first().json",
    "({ ...$('Grava Timestamp Msg').first().json, visit_development_id: " + leadId + " })");
}

export function patchWriter(w) {
  const condition = params(w, 'Tem 1?').conditions.conditions[0];
  condition.leftValue = change(condition.leftValue, ".all().length === 1",
    ".all().length === 1 && (" + pinnedId + " == null || String(" + pinnedId + ") === String($('Get Empreendimentos Total').first().json.id))");
  const validate = params(w, 'Valida Empreendimento em Foco');
  validate.jsCode = change(validate.jsCode, 'const raw = $json.empreendimento_em_foco_id;',
    'const raw = ' + pinnedId + ' ?? $json.empreendimento_em_foco_id;');
  const lookup = params(w, 'Get info empreendimento');
  lookup.filters.conditions.push({keyName:'id_empresa', keyValue:"={{ $('Start schedule').first().json.Empresa.id }}"});
  lookup.matchType = 'allFilters';
  const assignments = params(w, 'Empreendimento Resolvido Foco').assignments.assignments;
  assignments.find(a => a.name === 'id').value = '={{ $json.id }}';
  assignments.find(a => a.name === 'nome').value = '={{ $json.nome }}';
  const rd = params(w, 'RD - Atualiza etapa (scheduled)');
  rd.jsonBody = change(rd.jsonBody, "$('Get Empreendimento em Foco').item.json.empreendimento_em_foco_id", "$('Merge Resolvido').first().json.id");
}
