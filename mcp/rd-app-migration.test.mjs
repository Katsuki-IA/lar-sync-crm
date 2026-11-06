import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolveRdAppCredentials } from '../supabase/functions/_shared/rd-app-config.ts';

const baseline = {
  RD_CLIENT_ID: 'legacy-app', RD_CLIENT_SECRET: 'legacy-test-secret',
  RD_REDIRECT_URI: 'https://old.example/integracoes/rd',
  RD_MYHUB_CLIENT_ID: 'new-app', RD_MYHUB_CLIENT_SECRET: 'new-test-secret',
  RD_MYHUB_REDIRECT_URI: 'https://new.example/integracoes/rd',
  SUPABASE_URL: 'https://test.example',
};
const read = (env) => (key) => env[key];

test('staging credentials does not activate the new app', () => {
  assert.equal(resolveRdAppCredentials(read(baseline)).clientId, 'legacy-app');
});
test('activation selects new credentials only for new authorization', () => {
  const env = { ...baseline, RD_MYHUB_ENABLED: 'true' };
  assert.equal(resolveRdAppCredentials(read(env)).clientId, 'new-app');
  assert.equal(resolveRdAppCredentials(read(env), null).clientId, 'legacy-app');
  assert.equal(resolveRdAppCredentials(read(env), 'legacy-app').clientSecret, 'legacy-test-secret');
});
test('new connections keep their credentials after activation rollback', () => {
  assert.equal(resolveRdAppCredentials(read(baseline), 'new-app').clientSecret, 'new-test-secret');
});
test('unknown app and incomplete activation fail closed', () => {
  assert.throws(() => resolveRdAppCredentials(read(baseline), 'unknown-app'));
  for (const missing of ['RD_MYHUB_CLIENT_ID', 'RD_MYHUB_CLIENT_SECRET', 'RD_MYHUB_REDIRECT_URI']) {
    assert.throws(() => resolveRdAppCredentials(read({ ...baseline, RD_MYHUB_ENABLED: 'true', [missing]: '' })));
  }
});

async function loadRd(env, requests = [], updates = []) {
  let source = fs.readFileSync(new URL('../supabase/functions/_shared/rd.ts', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  source = stripTypeScriptTypes(source);
  const exports = ['getRdConfig', 'getRdAuthorizationConfig', 'getRdStateConfig', 'createRdSignedState', 'verifyRdSignedState', 'refreshRdAccessToken'];
  const createSupabaseAdmin = () => ({ from: () => ({ update: (value) => {
    const query = { eq: () => query, select: () => query, maybeSingle: async () => {
      updates.push(value); return { data: { id: 'test-connection' }, error: null };
    } }; return query;
  } }) });
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ access_token: 'rotated-test-token', expires_in: 3600 }), { status: 200 });
  };
  return new Function('Deno', 'createSupabaseAdmin', 'resolveLeadOrigin', 'resolveRdAppCredentials', 'fetch', source + '\nreturn {' + exports.join(',') + '};')(
    { env: { get: read(env) } }, createSupabaseAdmin, () => 'ND', resolveRdAppCredentials, fetch,
  );
}
test('legacy refresh uses original app after new activation; new refresh uses new app', async () => {
  const requests = [], updates = [];
  const rd = await loadRd({ ...baseline, RD_MYHUB_ENABLED: 'true' }, requests, updates);
  for (const app of [null, 'new-app']) {
    await rd.refreshRdAccessToken({ id: 'test-connection', access_token: null, refresh_token: 'test-refresh', token_expires_at: null, oauth_client_id: app });
  }
  assert.deepEqual(requests.map(r => r.body.client_id), ['legacy-app', 'new-app']);
  assert.deepEqual(requests.map(r => r.body.client_secret), ['legacy-test-secret', 'new-test-secret']);
  assert.equal(updates.length, 2);
});
test('OAuth callback uses signed app even if activation changes during login', async () => {
  const rd = await loadRd({ ...baseline, RD_MYHUB_ENABLED: 'true' });
  const state = await rd.createRdSignedState({ clientId: 'new-app', userId: 'user', idEmpresa: 25, empreendimentoId: 1, funnelId: 2, secret: 'new-test-secret' });
  const rolledBack = await loadRd(baseline);
  assert.equal(rolledBack.getRdStateConfig(state).clientId, 'new-app');
  const args = { state, expectedUserId: 'user', expectedEmpresa: 25, secret: rolledBack.getRdStateConfig(state).clientSecret };
  assert.deepEqual(await rolledBack.verifyRdSignedState(args), { empreendimentoId: 1, funnelId: 2 });
  await assert.rejects(rolledBack.verifyRdSignedState({ ...args, expectedEmpresa: 26 }));
  await assert.rejects(rolledBack.verifyRdSignedState({ ...args, secret: 'legacy-test-secret' }));
  const payload = JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString());
  payload.clientId = 'legacy-app';
  const tampered = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + state.split('.')[1];
  await assert.rejects(rolledBack.verifyRdSignedState({ ...args, state: tampered, secret: rolledBack.getRdStateConfig(tampered).clientSecret }));
});
test('in-flight legacy OAuth state without client ID remains valid', async () => {
  const rd = await loadRd({ ...baseline, RD_MYHUB_ENABLED: 'true' });
  const state = await rd.createRdSignedState({ userId: 'user', idEmpresa: 25, empreendimentoId: 1, funnelId: 2, secret: 'legacy-test-secret' });
  assert.equal(rd.getRdStateConfig(state).clientId, 'legacy-app');
  await rd.verifyRdSignedState({ state, expectedUserId: 'user', expectedEmpresa: 25, secret: rd.getRdStateConfig(state).clientSecret });
});

async function exchangeScenario(failure) {
  const operations = [];
  let handler;
  let source = fs.readFileSync(new URL('../supabase/functions/rd-oauth-exchange/index.ts', import.meta.url), 'utf8');
  source = stripTypeScriptTypes(source.replace(/^import \{[\s\S]*?\} from .*;\r?\n/gm, ''));
  const previous = { id: 'same-connection', webhook_uuid: 'old-webhook', oauth_client_id: null };
  const db = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: previous, error: null }) }) }),
    upsert: (value) => ({ select: () => ({ single: async () => {
      operations.push(['save', value.oauth_client_id]);
      return failure === 'save' ? { data: null, error: { message: 'db failure' } } : { data: { id: previous.id }, error: null };
    } }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }) };
  const stubs = {
    Deno: { serve: fn => { handler = fn; } },
    createSupabaseAdmin: () => db,
    getAuthorizedCrmUser: async () => ({ userId: 'user', crmUser: { id_empresa: 25 } }),
    handleOptions: () => null, jsonResponse: value => value,
    withErrorHandling: fn => fn(),
    getRdStateConfig: () => ({ clientId: 'new-app', clientSecret: 'test', supabaseUrl: 'https://test.example' }),
    verifyRdSignedState: async () => {
      if (failure === 'state') throw new Error('invalid state');
      return { empreendimentoId: 1, funnelId: 2 };
    },
    getValidRdAccessToken: async () => { operations.push(['old-token']); return 'old-test-token'; },
    exchangeRdAuthorizationCode: async (_code, config) => {
      operations.push(['exchange', config.clientId]);
      if (failure === 'exchange') throw new Error('exchange failure');
      return { accessToken: 'new-test-token', refreshToken: 'new-test-refresh', tokenExpiresAt: '2099-01-01' };
    },
    createRdWebhook: async () => {
      operations.push(['create-webhook']);
      return { webhookUuid: 'new-webhook', platformAccountId: 'account' };
    },
    deleteRdWebhook: async (_token, id) => {
      operations.push(['delete', id]);
      if (failure === 'cleanup') throw new Error('cleanup failure');
    },
    sha256Hex: async () => 'test-hash',
  };
  new Function(...Object.keys(stubs), source)(...Object.values(stubs));
  try {
    const result = await handler(new Request('https://test.example', { method: 'POST', body: JSON.stringify({ code: 'test-code', state: 'test-state' }) }));
    return { operations, result };
  } catch (error) { return { operations, error }; }
}
test('successful reconnection stores issuing app before removing old webhook', async () => {
  const { operations, result } = await exchangeScenario();
  assert.equal(result.ok, true);
  assert.deepEqual(operations, [['old-token'], ['exchange', 'new-app'], ['create-webhook'], ['save', 'new-app'], ['delete', 'old-webhook']]);
});
test('invalid state cannot access connection or exchange token', async () => {
  const { operations, error } = await exchangeScenario('state');
  assert.ok(error); assert.deepEqual(operations, []);
});
test('failed token exchange leaves old webhook and connection untouched', async () => {
  const { operations, error } = await exchangeScenario('exchange');
  assert.ok(error); assert.deepEqual(operations, [['old-token'], ['exchange', 'new-app']]);
});
test('failed persistence removes only the newly created webhook', async () => {
  const { operations, error } = await exchangeScenario('save');
  assert.ok(error); assert.deepEqual(operations.at(-1), ['delete', 'new-webhook']);
  assert.ok(!operations.some(op => op[0] === 'delete' && op[1] === 'old-webhook'));
});
test('old webhook cleanup failure reports pending cleanup after successful connection', async () => {
  const { result } = await exchangeScenario('cleanup');
  assert.equal(result.ok, true); assert.match(result.warning, /webhook anterior/);
});
