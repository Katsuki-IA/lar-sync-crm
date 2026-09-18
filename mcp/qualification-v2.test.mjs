import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationGate } from './qualification-v2.mjs';
const gate = (text, q = 0, history = [], extra = {}) => qualificationGate(
  { Mensagem: text, DadosLead: { MessageId: 'new' } }, { qualificado: q, ...extra }, history,
).avaliar_qualificacao;
test('strong signals are evaluated on the first response', () => {
  for (const text of ['Quero agendar uma visita', 'Tenho 230 mil para comprar no centro', 'Quero falar com corretor', 'Qual o valor?']) assert.equal(gate(text), true, text);
});
test('short acceptance is evaluated with visit context', () => {
  assert.equal(gate('Bom dia pode claro',0,[{ai:'Vamos agendar uma visita?'}]),true);
  assert.equal(gate('Sim',0,[{ai:'Quer marcar visita?'}]),true);
  assert.equal(gate('Sim'),false);
});
test('qualified lead is revisited for rejection or changed constraints', () => {
  for (const text of ['Não tenho interesse','Para mim não dá, procuro até 300mil','Prefiro outra região','Vocês falaram com a pessoa errada']) assert.equal(gate(text,1),true,text);
  assert.equal(gate('Obrigado!',1),false);
});
test('disqualified can reopen and duplicates/human attendance do not call model', () => {
  assert.equal(gate('Mudei de ideia, quero visitar',2),true);
  assert.equal(gate('Quero visitar',0,[],{qualificacao_message_id:'new'}),false);
  assert.equal(gate('Quero visitar',0,[],{atendimento_humano:true}),false);
  assert.equal(gate('Bom dia'),false);
});
test('history removes tool results and preserves speaker attribution', () => {
  const r=qualificationGate({Mensagem:'Qual valor?'},{},[{ai:[],tool:'private data'},{ai:'Quer visitar?',human:'sim'}]);
  assert.deepEqual(JSON.parse(r.mensagens),[{role:'assistant',text:'Quer visitar?'},{role:'user',text:'sim'}]);
});
