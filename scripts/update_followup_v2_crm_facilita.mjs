const workflowId = 'lxmbjkYZiSKfRnHl';
const base = process.env.N8N_API_URL;
const apiKey = process.env.N8N_API_KEY;

if (!base || !apiKey) {
  throw new Error('N8N_API_URL/N8N_API_KEY are not configured');
}

const root = base.endsWith('/') ? base.slice(0, -1) : base;
const headers = {
  'X-N8N-API-KEY': apiKey,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const response = await fetch(`${root}/api/v1/workflows/${workflowId}`, { headers });
if (!response.ok) {
  throw new Error(`Could not load workflow: HTTP ${response.status}`);
}

const workflow = await response.json();
const contextNode = workflow.nodes.find((node) => node.name === 'Carregar contexto CRM');
const switchNode = workflow.nodes.find((node) => node.name === 'CRM da empresa');

if (!contextNode || !switchNode) {
  throw new Error('Expected CRM context/switch nodes were not found');
}

if (!contextNode.parameters.query.includes('c.facilita_crm_instance')) {
  contextNode.parameters.query = contextNode.parameters.query.replace(
    '  c.rd_user_id\n',
    '  c.rd_user_id,\n  c.facilita_crm_instance,\n  c.facilita_crm_api,\n  c.facilita_crm_token\n',
  );
}

const rules = switchNode.parameters.rules.values;
if (!rules.some((rule) => rule.outputKey === 'Facilita')) {
  rules.push({
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [
        {
          id: 'provider-facilita-0',
          leftValue: "={{ String($json.crm_provider || '').toLowerCase() }}",
          rightValue: 'facilita',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey: 'Facilita',
  });
}

let facilitaNode = workflow.nodes.find((node) => node.name === 'Gravar alerta no Facilita');
if (!facilitaNode) {
  facilitaNode = {
    parameters: {
      method: 'POST',
      url: '=https://api.facilitaapp.com/platform/v1/deal/historical',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'api-instance',
            value: "={{ $('Carregar contexto CRM').item.json.facilita_crm_instance }}",
          },
          {
            name: 'api-key',
            value: "={{ $('Carregar contexto CRM').item.json.facilita_crm_api }}",
          },
          {
            name: 'token-user',
            value: "={{ $('Carregar contexto CRM').item.json.facilita_crm_token }}",
          },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        "={{ { type: 'chat', message: String($('Carregar contexto CRM').item.json.message_body || ''), deal_id: Number($('Carregar contexto CRM').item.json.lead_id_crm) } }}",
      options: {},
    },
    id: 'f2crm-facilita-message',
    name: 'Gravar alerta no Facilita',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1940, 1020],
    onError: 'continueRegularOutput',
  };
  workflow.nodes.push(facilitaNode);
}

const unsupportedNode = workflow.nodes.find((node) => node.name === 'Registrar CRM não suportado');
if (unsupportedNode) {
  unsupportedNode.position = [1940, 1180];
}

const switchOutputs = workflow.connections['CRM da empresa'].main;
const facilitaOutput = [{ node: 'Gravar alerta no Facilita', type: 'main', index: 0 }];
const unsupportedOutput = switchOutputs.find((output) =>
  output.some((connection) => connection.node === 'Registrar CRM não suportado'),
);
const providerOutputs = switchOutputs.filter(
  (output) =>
    !output.some((connection) => connection.node === 'Registrar CRM não suportado') &&
    !output.some((connection) => connection.node === 'Gravar alerta no Facilita'),
);
workflow.connections['CRM da empresa'].main = [
  ...providerOutputs,
  facilitaOutput,
  unsupportedOutput ?? [{ node: 'Registrar CRM não suportado', type: 'main', index: 0 }],
];

workflow.connections['Gravar alerta no Facilita'] = {
  main: [[{ node: 'Normalizar resposta CRM', type: 'main', index: 0 }]],
};

const payload = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings,
};

if (workflow.staticData !== undefined) {
  payload.staticData = workflow.staticData;
}

const updateResponse = await fetch(`${root}/api/v1/workflows/${workflowId}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(payload),
});
const updated = await updateResponse.json();
if (!updateResponse.ok) {
  throw new Error(`Could not update workflow: HTTP ${updateResponse.status} ${JSON.stringify(updated)}`);
}

const verifyResponse = await fetch(`${root}/api/v1/workflows/${workflowId}`, { headers });
const verified = await verifyResponse.json();
const verifiedContext = verified.nodes.find((node) => node.name === 'Carregar contexto CRM');
const verifiedSwitch = verified.nodes.find((node) => node.name === 'CRM da empresa');

console.log(
  JSON.stringify(
    {
      workflowId: verified.id,
      name: verified.name,
      active: verified.active,
      facilitaNode: verified.nodes.some((node) => node.name === 'Gravar alerta no Facilita'),
      facilitaCredentialsLoaded: verifiedContext?.parameters?.query?.includes('facilita_crm_instance'),
      facilitaRoute: verifiedSwitch?.parameters?.rules?.values?.some(
        (rule) => rule.outputKey === 'Facilita',
      ),
      outputs: verified.connections?.['CRM da empresa']?.main?.length,
    },
    null,
    2,
  ),
);
