import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExecution } from './ai-cost-normalize.mjs';
function fixture(usages) {
  return {id:'12',workflowId:'w',startedAt:'2026-11-12T10:00:00Z',workflowData:{nodes:[{id:'n',name:'Model',type:'@n8n/n8n-nodes-langchain.lmChatOpenAi',parameters:{model:'gpt-4.1'}}]},data:{resultData:{runData:{Start:[{data:{main:[[{json:{Empresa_id:42,Mensagem:'secret'}}]]}}],Model:usages.map(u=>({data:{ai_languageModel:[[{json:{usage:u,response:{text:'secret'}}}]]}}))}}}};
}
test('each internal call and retry has a stable independent key',()=>{
  const e=fixture([{prompt_tokens:100,completion_tokens:12,prompt_tokens_details:{cached_tokens:60}},{prompt_tokens:200,completion_tokens:20}]);
  const a=normalizeExecution(e); assert.equal(a.events.length,2); assert.notEqual(a.events[0].event_key,a.events[1].event_key); assert.deepEqual(a,normalizeExecution(e));
  assert.equal(a.events[0].cached_tokens,60); assert.equal(a.events[1].cached_tokens,null); assert.equal(a.events[1].usage_status,'cache_unknown'); assert.equal(a.events[0].id_empresa,42); assert.ok(!JSON.stringify(a).includes('secret'));
});
test('unknown usage is not zero and conflicting companies are not allocated',()=>{
  const e=fixture([{}]); e.data.resultData.runData.Other=[{data:{main:[[{json:{id_empresa:99}}]]}}];
  const a=normalizeExecution(e).events[0]; assert.equal(a.id_empresa,null); assert.equal(a.attribution_status,'ambiguous'); assert.equal(a.input_tokens,null); assert.equal(a.usage_status,'missing');
});
test('DeepSeek cache and invalid counts',()=>{
  const e=fixture([{prompt_cache_hit_tokens:20,prompt_cache_miss_tokens:80,completion_tokens:5}]); e.workflowData.nodes[0].type='@n8n/n8n-nodes-langchain.lmChatDeepSeek';
  assert.equal(normalizeExecution(e).events[0].input_tokens,100);
  assert.equal(normalizeExecution(fixture([{prompt_tokens:1,prompt_tokens_details:{cached_tokens:2},completion_tokens:1}])).events[0].usage_status,'invalid');
});
test('executed failures and redacted executions do not disappear',()=>{
  const e=fixture([]);e.data.resultData.runData.Model=[{error:{message:'secret'}}];
  assert.equal(normalizeExecution(e).events[0].usage_status,'missing'); assert.throws(()=>normalizeExecution({id:1}),/execution_data_missing/);
});
test('n8n token estimates are explicitly distinguished from provider measurements',()=>{
 const e=fixture([]);e.data.resultData.runData.Model=[{data:{ai_languageModel:[[{json:{tokenUsageEstimate:{promptTokens:100,completionTokens:12}}}]]}}];
 const a=normalizeExecution(e).events[0];assert.equal(a.input_tokens,100);assert.equal(a.usage_status,'estimated');assert.equal(a.cached_tokens,null);
});
