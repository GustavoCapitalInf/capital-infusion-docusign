import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';

function fixture() {
  const calls = [];
  const config = { docusign: { maxWebhookBytes: 100_000, hmacSecret: 'secret', requireHmac: true } };
  const storage = {
    claim: async (event) => ({ claimed: true, file: '/event.json', event }),
  };
  const processor = { process: async (...args) => calls.push(args) };
  const auth = {
    testAuthentication: async () => ({
      accountId: 'account-1',
      accountName: 'Capital Infusion',
      baseUri: 'https://demo.docusign.net',
    }),
  };
  const logger = { info() {}, warn() {}, error() {} };
  return { calls, config, storage, processor, auth, logger };
}

async function invoke(dependencies, { body = '', headers = {}, method = 'POST', url = '/api/webhooks/docusign' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { headers, method, url });
  let status;
  let contents = '';
  const response = {
    headersSent: false,
    writeHead(value) { status = value; this.headersSent = true; },
    end(value = '') { contents += value; },
  };
  await createApp(dependencies)(request, response);
  return { status, body: contents ? JSON.parse(contents) : undefined };
}

test('acknowledges completed events before scheduling processing', async () => {
  const dependencies = fixture();
  const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'env-1' } });
  const signature = createHmac('sha256', 'secret').update(body).digest('base64');
  const response = await invoke(dependencies, {
    body,
    headers: { 'content-type': 'application/json', 'x-docusign-signature-1': signature },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { accepted: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dependencies.calls.length, 1);
  assert.equal(dependencies.calls[0][0].envelopeId, 'env-1');
});

test('rejects unsigned payloads and does not claim them', async () => {
  const dependencies = fixture();
  let claimed = false;
  dependencies.storage.claim = async () => { claimed = true; };
  const response = await invoke(dependencies, {
    headers: { 'content-type': 'application/json' },
    body: '{"event":"envelope-completed","data":{"envelopeId":"env-1"}}',
  });
  assert.equal(response.status, 401);
  assert.equal(claimed, false);
});

test('accepts unsupported events without processing', async () => {
  const dependencies = fixture();
  const body = JSON.stringify({ event: 'envelope-sent', data: { envelopeId: 'env-1' } });
  const signature = createHmac('sha256', 'secret').update(body).digest('base64');
  const response = await invoke(dependencies, {
    body,
    headers: { 'content-type': 'application/json', 'x-docusign-signature-1': signature },
  });
  assert.equal(response.status, 202);
  assert.equal(dependencies.calls.length, 0);
});

test('returns only safe account fields from the auth diagnostic', async () => {
  const dependencies = fixture();
  const response = await invoke(dependencies, { method: 'GET', url: '/api/docusign/test-auth' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    authenticated: true,
    accountId: 'account-1',
    accountName: 'Capital Infusion',
    baseUri: 'https://demo.docusign.net',
  });
  assert.equal(JSON.stringify(response.body).includes('token'), false);
});

test('returns safe structured auth failures', async () => {
  const dependencies = fixture();
  dependencies.auth.testAuthentication = async () => {
    throw Object.assign(new Error('Consent is required'), {
      code: 'consent_required',
      phase: 'oauth',
      privateKeyLoaded: true,
      privateKeyParsed: true,
    });
  };
  const response = await invoke(dependencies, { method: 'GET', url: '/api/docusign/test-auth' });
  assert.equal(response.status, 502);
  assert.deepEqual(response.body, {
    success: false,
    authenticated: false,
    error: 'consent_required',
    message: 'Consent is required',
    privateKeyLoaded: true,
    privateKeyParsed: true,
    userInfoSucceeded: false,
  });
});

test('runs a safe R2 connectivity test through the storage provider', async () => {
  const dependencies = fixture();
  dependencies.storage.provider = 'r2';
  dependencies.storage.bucket = 'private-bucket';
  dependencies.storage.testConnectivity = async () => ({
    success: true,
    provider: 'r2',
    bucket: 'private-bucket',
    upload: true,
    read: true,
    delete: true,
  });
  const response = await invoke(dependencies, { method: 'POST', url: '/api/storage/test-r2' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    provider: 'r2',
    bucket: 'private-bucket',
    upload: true,
    read: true,
    delete: true,
  });
});

test('reports missing R2 configuration without exposing configuration', async () => {
  const dependencies = fixture();
  dependencies.storage.provider = 'filesystem';
  const response = await invoke(dependencies, { method: 'POST', url: '/api/storage/test-r2' });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    success: false,
    provider: 'filesystem',
    error: 'R2 configuration missing',
  });
});
