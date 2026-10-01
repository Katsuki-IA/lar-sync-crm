import assert from 'node:assert/strict';
import {validateRouting,buildNegotiationWorkflow,buildNegotiationSchedule} from './c2s-negotiation-routing.mjs';
for(const tipo of ['venda','locacao']) assert.equal(validateRouting({routing:{tipo_negociacao:tipo,fila_id:18197}}).routing.tipo_negociacao,tipo);
for(const tipo of ['ambos','indefinido',null]) assert.throws(()=>validateRouting({routing:{tipo_negociacao:tipo,fila_id:18197}}));
for(const fila of [null,0,-1,'bad']) assert.throws(()=>validateRouting({routing:{tipo_negociacao:'locacao',fila_id:fila}}));
console.log('Routing guards passed');
export function testWorkflow(base,schedule) {
  const w=buildNegotiationWorkflow(base), get=name=>w.nodes.find(n=>n.name===name);
  assert.equal(w.connections['Resolve Identidade C2S'].main[0][0].node,'Resolve Roteamento C2S');
  assert.equal(w.connections['Salva Vinculo C2S'].main[0][0].node,'Redistribui Lead C2S');
  assert(get('Cria Lead C2S').parameters.jsonBody.includes('attributes.type_negotiation'));
  assert(!get('Redistribui Lead C2S').parameters.url.includes('33585'));
  assert(get('Salva Vinculo C2S').parameters.query.includes("status='pending'"));
  assert.equal(w.connections['Reutiliza ID C2S'].main[0][0].node,'Registra Mensagem C2S');
  const names=new Set(w.nodes.map(n=>n.name));
  for(const c of Object.values(w.connections)) for(const branch of c.main||[]) for(const edge of branch) assert(names.has(edge.node));
  const updated=buildNegotiationSchedule(schedule);
  assert(!JSON.stringify(updated.connections).includes('C2S Hub - redistribuir'));
  assert(!updated.nodes.some(n=>n.name==='C2S Hub - redistribuir'));
  const redistribute=updated.nodes.find(n=>n.name==='Redistribuir na Fila');
  assert(redistribute.parameters.url.includes('routing.fila_id'));
  assert(!redistribute.parameters.url.includes('Lead.id_crm'));
  assert(redistribute.parameters.jsonBody.includes('c2s_lead_id'));
  const scheduleNames=new Set(updated.nodes.map(n=>n.name));
  for(const c of Object.values(updated.connections)) for(const branch of c.main||[]) for(const edge of branch) assert(scheduleNames.has(edge.node));
  console.log('Workflow graph, duplicate guards and schedule integration passed');
  return {w,updated};
}
