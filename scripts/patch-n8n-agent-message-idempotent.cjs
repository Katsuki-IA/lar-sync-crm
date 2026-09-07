const workflowId = '7GKceKnRBzw5st11';
const baseUrl = process.env.N8N_API_URL;
const apiKey = process.env.N8N_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error('N8N_API_URL e N8N_API_KEY precisam estar configurados.');
}

const root = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
const headers = {
  'X-N8N-API-KEY': apiKey,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function request(path, options = {}) {
  const response = await fetch(`${root}${path}`, { headers, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
const workflow = await request(`/api/v1/workflows/${workflowId}`);
const node = workflow.nodes.find((candidate) => candidate.name === 'Criar Cliente1');

if (!node) {
  throw new Error('Nó Criar Cliente1 não encontrado.');
}

if (node.type === 'n8n-nodes-base.postgres' && node.parameters?.query?.includes('wa_finalize_crm_lead_record')) {
  console.log(JSON.stringify({
    changed: false,
    reason: 'already_patched',
    workflowId,
    versionId: workflow.versionId,
  }));
  process.exit(0);
}

if (
  node.type !== 'n8n-nodes-base.supabase'
  && !(node.type === 'n8n-nodes-base.postgres' && node.parameters?.query?.includes('wa_get_or_create_lead_record'))
) {
  throw new Error(`Tipo inesperado no nó Criar Cliente1: ${node.type}`);
}

const previousVersionId = workflow.versionId;
const editableSettingKeys = [
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'executionOrder',
  'callerPolicy',
];
const editableSettings = Object.fromEntries(
  Object.entries(workflow.settings ?? {}).filter(([key]) => editableSettingKeys.includes(key)),
);

node.type = 'n8n-nodes-base.postgres';
node.typeVersion = 2.6;
node.alwaysOutputData = true;
node.credentials = {
  postgres: {
    id: 'WyPVUxmqPcUYXxCq',
    name: 'Supabase-unico',
  },
};
node.parameters = {
  operation: 'executeQuery',
  query: `with finalized as materialized (
  select *
  from public.wa_finalize_crm_lead_record(
    $1::bigint,
    nullif($2::text, ''),
    nullif($3::text, ''),
    nullif($4::text, ''),
    $5::bigint,
    nullif($6::text, ''),
    nullif($7::text, ''),
    nullif($8::text, ''),
    nullif($9::text, '')
  )
)
select
  l.*,
  f.outcome as identity_resolution_outcome,
  f.created as identity_lead_created,
  f.wa_identity_id as resolved_wa_identity_id,
  f.wa_user_id as resolved_wa_user_id,
  f.telefone as resolved_telefone,
  f.conversation_key as resolved_conversation_key,
  f.legacy_conversation_key as resolved_legacy_conversation_key,
  f.active_session_key as resolved_active_session_key
from finalized f
left join lateral pg_catalog.jsonb_populate_record(null::public.lead, f.lead_data) l on true
limit 1;`,
  options: {
    queryReplacement: `={{ (() => {
  const start = $('Start to agent message').first().json;
  const dados = start.DadosLead ?? {};
  const interesse = $('Get Interesse').first().json;
  const normalized = $('Normaliza id CRM').first().json;
  const rdClientId = $('Cria Contato no RD CRM v2').isExecuted
    ? $('Cria Contato no RD CRM v2').first().json?.data?.id
    : null;
  return [
    Number(start.Empresa_id ?? start.Empresa?.id),
    String(dados.wa_user_id ?? dados.contact_identifier ?? '').trim(),
    String(dados.numero ?? '').replace(/\\D/g, ''),
    String(dados.LeadNome ?? '').trim(),
    interesse.empreendimento_id == null ? null : Number(interesse.empreendimento_id),
    String(normalized.id_crm ?? '').trim(),
    rdClientId == null ? '' : String(rdClientId),
    String(dados.wa_parent_user_id ?? '').trim(),
    String(dados.wa_username ?? '').trim()
  ];
})() }}`,
  },
};

const updated = await request(`/api/v1/workflows/${workflowId}`, {
  method: 'PUT',
  body: JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: editableSettings,
  }),
});

const verifiedNode = updated.nodes?.find((candidate) => candidate.name === 'Criar Cliente1');
if (verifiedNode?.type !== 'n8n-nodes-base.postgres' || !verifiedNode.parameters?.query?.includes('wa_finalize_crm_lead_record')) {
  throw new Error('O n8n respondeu, mas a alteração do nó não foi confirmada.');
}

console.log(JSON.stringify({
  changed: true,
  workflowId,
  active: updated.active,
  previousVersionId,
  versionId: updated.versionId,
  node: verifiedNode.name,
  nodeType: verifiedNode.type,
}));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
