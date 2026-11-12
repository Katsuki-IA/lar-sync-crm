// Used both by the n8n collector and offline tests. Never persist messages/credentials.
export function normalizeExecution(execution) {
  const runs = execution.data?.resultData?.runData;
  const nodes = execution.workflowData?.nodes;
  if (!runs || !Array.isArray(nodes)) throw new Error('execution_data_missing');
  const integer = v => v !== null && v !== undefined && v !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const companyIds = new Set();
  function companies(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(o)) {
      if (/^(id_empresa|empresa_id|Empresa_id|company_id)$/.test(k) || (k === 'empresa' && typeof v !== 'object')) {
        const id = integer(v); if (id > 0) companyIds.add(id);
      } else if (k === 'Empresa' && v && typeof v === 'object') {
        const id = integer(v.id); if (id > 0) companyIds.add(id);
      } else if (['body','data','DadosLead','Lead','lead','lead_snapshot','context','json'].includes(k) || Array.isArray(o)) companies(v, depth + 1);
    }
  }
  // Only explicit structured IDs count. Ambiguous multi-company executions remain unattributed.
  for (const list of Object.values(runs)) for (const run of list) for (const outputs of Object.values(run.data || {}))
    for (const items of outputs || []) for (const item of items || []) companies(item.json);
  const company = companyIds.size === 1 ? [...companyIds][0] : null;
  const events = [];
  for (const node of nodes) {
    const provider = /lmChatDeepSeek/.test(node.type) ? 'deepseek' : /lmChatOpenAi|langchain.openAi$/.test(node.type) ? 'openai' : null;
    if (!provider) continue;
    const modelValue = node.parameters?.model ?? node.parameters?.modelId;
    const configured = typeof modelValue === 'string' ? modelValue : modelValue?.value;
    const configuredModel = configured && !configured.startsWith('=') ? configured : provider === 'deepseek' && node.typeVersion === 1 ? 'deepseek-chat' : null;
    for (const [runIndex, run] of (runs[node.name] || []).entries()) {
      const connection = /lmChat/.test(node.type) ? 'ai_languageModel' : 'main';
      const outputs = run.data?.[connection] || [];
      let found = false;
      for (const [outputIndex, items] of outputs.entries()) for (const [itemIndex, item] of (items || []).entries()) {
        found = true;
        const j = item.json || {};
        const measured = j.usage ?? j.tokenUsage ?? j.response?.usage ?? j.response?.tokenUsage ?? j.usage_metadata;
        const estimated = !measured && !!j.tokenUsageEstimate;
        const u = measured ?? j.tokenUsageEstimate ?? {};
        let input = integer(u.prompt_tokens ?? u.input_tokens ?? u.promptTokens);
        const output = integer(u.completion_tokens ?? u.output_tokens ?? u.completionTokens);
        let cached = integer(u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? u.input_token_details?.cache_read ?? u.prompt_cache_hit_tokens);
        const miss = integer(u.prompt_cache_miss_tokens);
        if (input === null && cached !== null && miss !== null) input = cached + miss;
        const invalid = cached !== null && input !== null && cached > input;
        if (invalid) cached = null;
        const returnedModel = j.model ?? j.response?.model ?? j.response?.llmOutput?.modelName;
        const model = typeof returnedModel === 'string' ? returnedModel : configuredModel;
        events.push({
          event_key: `${execution.id}:${node.id}:${runIndex}:${outputIndex}:${itemIndex}`,
          execution_id: String(execution.id), workflow_id: String(execution.workflowId ?? execution.workflowData.id),
          node_id: node.id, node_name: node.name, run_index: runIndex, id_empresa: company,
          occurred_at: new Date(run.startTime ?? execution.startedAt).toISOString(),
          provider, model, model_source: returnedModel ? 'response' : configuredModel ? 'configuration' : 'unknown',
          operation: node.parameters?.resource === 'audio' ? 'audio' : 'text',
          input_tokens: invalid ? null : input, cached_tokens: cached, output_tokens: output,
          usage_status: invalid ? 'invalid' : input !== null && output !== null ? estimated ? 'estimated' : cached !== null ? 'complete' : 'cache_unknown' : 'missing',
          attribution_status: company !== null ? 'explicit' : companyIds.size > 1 ? 'ambiguous' : 'missing',
          request_id: typeof j.id === 'string' && /^(chatcmpl-|resp_)/.test(j.id) ? j.id : null,
        });
      }
      if (!found) events.push({event_key:`${execution.id}:${node.id}:${runIndex}:error`,execution_id:String(execution.id),workflow_id:String(execution.workflowId ?? execution.workflowData.id),node_id:node.id,node_name:node.name,run_index:runIndex,id_empresa:company,occurred_at:new Date(run.startTime ?? execution.startedAt).toISOString(),provider,model:configuredModel,model_source:configuredModel?'configuration':'unknown',operation:node.parameters?.resource==='audio'?'audio':'text',input_tokens:null,cached_tokens:null,output_tokens:null,usage_status:'missing',attribution_status:company!==null?'explicit':companyIds.size>1?'ambiguous':'missing',request_id:null});
    }
  }
  return {execution_id:String(execution.id), workflow_id:String(execution.workflowId ?? execution.workflowData.id), events};
}
