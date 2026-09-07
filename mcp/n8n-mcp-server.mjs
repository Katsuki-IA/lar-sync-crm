#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backupDirectory = path.join(scriptDirectory, 'backups');
const serverInfo = { name: 'n8n-crm', version: '0.1.0' };

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured. Set it as a user environment variable and restart Codex.`);
  }
  return value;
}

function apiBaseUrl() {
  return `${requiredEnvironment('N8N_API_URL').replace(/\/+$/, '')}/api/v1`;
}

async function n8nRequest(endpoint, options = {}) {
  const response = await fetch(`${apiBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': requiredEnvironment('N8N_API_KEY'),
      ...options.headers,
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.slice(0, 500) || response.statusText;
    throw new Error(`n8n API returned ${response.status}: ${detail}`);
  }

  try {
    return responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error('n8n API returned a response that was not JSON. Check N8N_API_URL.');
  }
}

function jsonContent(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function errorContent(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

function workflowValidation(workflow) {
  const issues = [];
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const names = new Set();

  if (!workflow || typeof workflow !== 'object') {
    return { valid: false, issues: ['Workflow must be a JSON object.'] };
  }
  if (!workflow.name || typeof workflow.name !== 'string') {
    issues.push('Workflow must have a non-empty name.');
  }
  if (!Array.isArray(workflow.nodes)) {
    issues.push('Workflow must contain a nodes array.');
  }

  for (const node of nodes) {
    if (!node?.name || typeof node.name !== 'string') {
      issues.push('Every node must have a name.');
      continue;
    }
    if (names.has(node.name)) {
      issues.push(`Duplicate node name: ${node.name}`);
    }
    names.add(node.name);
    if (!node.type || typeof node.type !== 'string') {
      issues.push(`Node ${node.name} has no type.`);
    }
  }

  const connections = workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {};
  for (const [sourceName, connectionTypes] of Object.entries(connections)) {
    if (!names.has(sourceName)) {
      issues.push(`Connection source does not exist: ${sourceName}`);
    }
    for (const outputs of Object.values(connectionTypes || {})) {
      for (const output of outputs || []) {
        for (const target of output || []) {
          if (target?.node && !names.has(target.node)) {
            issues.push(`Connection target does not exist: ${target.node}`);
          }
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    nodeCount: nodes.length,
    issues,
  };
}

function workflowForWrite(workflow) {
  // The public API rejects several internal properties returned by GET
  // (for example availableInMCP and callerPolicy inside settings). Keep
  // writes to the portable workflow definition accepted by every instance.
  const allowedKeys = ['name', 'nodes', 'connections'];
  const definition = Object.fromEntries(
    allowedKeys
      .filter((key) => workflow?.[key] !== undefined)
      .map((key) => [key, workflow[key]]),
  );
  // n8n requires the settings field, but its GET-only flags must not be sent.
  return { ...definition, settings: {} };
}

async function backupWorkflow(workflowId, label) {
  const workflow = await n8nRequest(`/workflows/${encodeURIComponent(workflowId)}`);
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${safeFileSegment(label || workflow.name)}-${safeFileSegment(workflowId)}.json`;
  const backupPath = path.join(backupDirectory, filename);
  await writeFile(backupPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
  return { workflow, backupPath };
}

function safeFileSegment(value) {
  return String(value || 'workflow').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'workflow';
}

const tools = [
  {
    name: 'n8n_list_workflows',
    description: 'List workflows available through the n8n public API. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        active: { type: 'boolean', description: 'Filter by active status.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: 'n8n_get_workflow',
    description: 'Get the complete JSON definition of one workflow. Read-only.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id'],
      properties: { workflow_id: { type: 'string' } },
    },
  },
  {
    name: 'n8n_backup_workflow',
    description: 'Export a workflow JSON into an ignored local backup file before making changes. Read-only against n8n.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id'],
      properties: {
        workflow_id: { type: 'string' },
        label: { type: 'string', description: 'Optional descriptive label for the backup file.' },
      },
    },
  },
  {
    name: 'n8n_validate_workflow',
    description: 'Validate the structural basics of a workflow JSON, including nodes and connections. Does not modify n8n.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string', description: 'Validate a workflow fetched from n8n.' },
        workflow: { type: 'object', description: 'Validate a supplied workflow JSON object.' },
      },
      oneOf: [{ required: ['workflow_id'] }, { required: ['workflow'] }],
    },
  },
  {
    name: 'n8n_create_workflow',
    description: 'Create a new n8n workflow through the public API. The workflow is validated before creation.',
    inputSchema: {
      type: 'object',
      required: ['workflow'],
      properties: {
        workflow: { type: 'object', description: 'Workflow definition with name, nodes and connections.' },
      },
    },
  },
  {
    name: 'n8n_update_workflow',
    description: 'Update an existing n8n workflow. Creates an ignored local backup before writing and validates the definition first.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id', 'workflow'],
      properties: {
        workflow_id: { type: 'string' },
        workflow: { type: 'object', description: 'Complete replacement definition with name, nodes and connections.' },
        backup_label: { type: 'string', description: 'Optional descriptive label for the automatic backup.' },
      },
    },
  },
  {
    name: 'n8n_set_workflow_active',
    description: 'Activate or deactivate an existing workflow. Creates an ignored local backup before changing its status.',
    inputSchema: {
      type: 'object',
      required: ['workflow_id', 'active'],
      properties: {
        workflow_id: { type: 'string' },
        active: { type: 'boolean' },
        backup_label: { type: 'string', description: 'Optional descriptive label for the automatic backup.' },
      },
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'n8n_list_workflows': {
      const params = new URLSearchParams();
      if (typeof args.active === 'boolean') params.set('active', String(args.active));
      params.set('limit', String(Math.min(Math.max(Number(args.limit) || 50, 1), 100)));
      const result = await n8nRequest(`/workflows?${params}`);
      const workflows = Array.isArray(result?.data) ? result.data : [];
      return {
        content: jsonContent({
          data: workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
            active: workflow.active,
            isArchived: workflow.isArchived,
            createdAt: workflow.createdAt,
            updatedAt: workflow.updatedAt,
            versionId: workflow.versionId,
            projectId: workflow.shared?.[0]?.projectId,
          })),
          nextCursor: result?.nextCursor ?? null,
        }),
      };
    }
    case 'n8n_get_workflow': {
      if (!args.workflow_id) throw new Error('workflow_id is required.');
      const result = await n8nRequest(`/workflows/${encodeURIComponent(args.workflow_id)}`);
      return { content: jsonContent(result) };
    }
    case 'n8n_backup_workflow': {
      if (!args.workflow_id) throw new Error('workflow_id is required.');
      const { workflow, backupPath } = await backupWorkflow(args.workflow_id, args.label);
      return { content: jsonContent({ backupPath, workflowId: args.workflow_id, workflowName: workflow.name }) };
    }
    case 'n8n_validate_workflow': {
      let workflow = args.workflow;
      if (args.workflow_id) {
        workflow = await n8nRequest(`/workflows/${encodeURIComponent(args.workflow_id)}`);
      }
      return { content: jsonContent(workflowValidation(workflow)) };
    }
    case 'n8n_create_workflow': {
      const validation = workflowValidation(args.workflow);
      if (!validation.valid) throw new Error(`Workflow inválido: ${validation.issues.join(' ')}`);
      const result = await n8nRequest('/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowForWrite(args.workflow)),
      });
      return { content: jsonContent(result) };
    }
    case 'n8n_update_workflow': {
      if (!args.workflow_id) throw new Error('workflow_id is required.');
      const validation = workflowValidation(args.workflow);
      if (!validation.valid) throw new Error(`Workflow inválido: ${validation.issues.join(' ')}`);
      const { backupPath } = await backupWorkflow(args.workflow_id, args.backup_label || 'before-update');
      const result = await n8nRequest(`/workflows/${encodeURIComponent(args.workflow_id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowForWrite(args.workflow)),
      });
      return { content: jsonContent({ backupPath, workflow: result }) };
    }
    case 'n8n_set_workflow_active': {
      if (!args.workflow_id || typeof args.active !== 'boolean') {
        throw new Error('workflow_id and active are required.');
      }
      const { backupPath } = await backupWorkflow(args.workflow_id, args.backup_label || 'before-activation-change');
      const action = args.active ? 'activate' : 'deactivate';
      const result = await n8nRequest(`/workflows/${encodeURIComponent(args.workflow_id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { content: jsonContent({ backupPath, workflow: result }) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) return;
  if (message.id === undefined) return;

  try {
    let result;
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: message.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo,
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools };
        break;
      case 'tools/call':
        result = await callTool(message.params?.name, message.params?.arguments || {});
        break;
      default:
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
        return;
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    if (message.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: message.id, result: errorContent(error) });
    } else {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
    }
  }
}

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({ serverInfo, tools: tools.map(({ name }) => name) }, null, 2));
} else {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        void handleMessage(JSON.parse(line));
      } catch {
        // Ignore malformed JSON-RPC input to keep the stdio stream usable.
      }
    }
  });
}
