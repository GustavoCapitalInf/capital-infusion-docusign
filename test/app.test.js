import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';

function fixture() {
  const calls = [];
  const config = { docusign: { maxWebhookBytes: 100_000, hmacSecret: 'secret', requireHmac: true } };
  const storage = {
    provider: 'filesystem',
    claim: async (event) => ({ claimed: true, file: '/event.json', event }),
    listReps: async () => [],
    listRepEnvelopes: async () => undefined,
    listEnvelopes: async () => [],
    getEnvelope: async () => undefined,
    getDocument: async () => undefined,
  };
  const processor = { process: async (...args) => calls.push(args) };
  const auth = {
    testAuthentication: async () => ({
      accountId: 'account-1',
      accountName: 'Capital Infusion',
      baseUri: 'https://demo.docusign.net',
    }),
  };
  const contractLifecycle = {
    enrichReps: async (reps) => reps,
    listRenewals: async () => [],
    getRepContract: async () => undefined,
  };
  const logger = { info() {}, warn() {}, error() {} };
  return { calls, config, storage, processor, auth, contractLifecycle, logger };
}

async function invoke(dependencies, { body = '', headers = {}, method = 'POST', url = '/api/webhooks/docusign' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { headers, method, url });
  let status;
  let responseHeaders;
  let contents = '';
  const response = {
    headersSent: false,
    writeHead(value, responseHeaderValues) { status = value; responseHeaders = responseHeaderValues; this.headersSent = true; },
    write(value) { contents += Buffer.from(value).toString('binary'); },
    end(value = '') { contents += value; },
    destroy(error) { throw error; },
  };
  await createApp(dependencies)(request, response);
  let parsedBody;
  if (contents) {
    try { parsedBody = JSON.parse(contents); } catch { parsedBody = contents; }
  }
  return { status, body: parsedBody, headers: responseHeaders };
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

test('lists reps with search and activity sorting', async () => {
  const dependencies = fixture();
  dependencies.storage.listReps = async () => [
    { repId: 'old@capital-infusion.com', name: 'Old Rep', email: 'old@capital-infusion.com', completedEnvelopeCount: 4, latestCompletedAt: '2026-01-01' },
    { repId: 'john@capital-infusion.com', name: 'John Smith', email: 'john@capital-infusion.com', completedEnvelopeCount: 2, latestCompletedAt: '2026-08-20' },
  ];
  const response = await invoke(dependencies, { method: 'GET', url: '/api/reps?search=john&sort=recent' });
  assert.equal(response.status, 200);
  assert.equal(response.body.reps.length, 1);
  assert.equal(response.body.reps[0].repId, 'john@capital-infusion.com');
});

test('sorts tracked contracts by expiration with reps without contracts last', async () => {
  const dependencies = fixture();
  dependencies.storage.listReps = async () => [
    { repId: 'none@example.com', name: 'No Contract', completedEnvelopeCount: 1 },
    { repId: 'later@example.com', name: 'Later', completedEnvelopeCount: 1 },
    { repId: 'sooner@example.com', name: 'Sooner', completedEnvelopeCount: 1 },
  ];
  dependencies.contractLifecycle.enrichReps = async (reps) => reps.map((item) => ({
    ...item,
    contract: item.repId === 'none@example.com' ? undefined : {
      expiresAt: item.repId === 'sooner@example.com' ? '2027-01-01' : '2027-03-01',
    },
  }));
  const response = await invoke(dependencies, { method: 'GET', url: '/api/reps?sort=expiration' });
  assert.deepEqual(response.body.reps.map((item) => item.repId), [
    'sooner@example.com',
    'later@example.com',
    'none@example.com',
  ]);
});

test('returns contract lifecycle and upcoming renewals without changing envelope counts', async () => {
  const dependencies = fixture();
  const contract = {
    repId: 'rep@example.com',
    currentTier: 1,
    nextTier: 2,
    expiresAt: '2027-02-19T00:00:00Z',
    daysRemaining: 30,
    contracts: [],
  };
  dependencies.storage.listReps = async () => [{
    repId: 'rep@example.com',
    name: 'Example Rep',
    email: 'rep@example.com',
    completedEnvelopeCount: 5,
  }];
  dependencies.contractLifecycle.enrichReps = async (reps) => reps.map((rep) => ({ ...rep, contract }));
  dependencies.contractLifecycle.getRepContract = async () => contract;
  dependencies.contractLifecycle.listRenewals = async () => [{
    repId: 'rep@example.com', currentTier: 1, nextTier: 2, expiresAt: contract.expiresAt, daysRemaining: 30,
  }];
  const reps = await invoke(dependencies, { method: 'GET', url: '/api/reps' });
  assert.equal(reps.body.reps[0].completedEnvelopeCount, 5);
  assert.equal(reps.body.reps[0].contract.currentTier, 1);
  const detail = await invoke(dependencies, { method: 'GET', url: '/api/reps/REP%40EXAMPLE.COM/contract' });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.nextTier, 2);
  const renewals = await invoke(dependencies, { method: 'GET', url: '/api/contracts/renewals' });
  assert.equal(renewals.status, 200);
  assert.equal(renewals.body.renewals.length, 1);
});

test('lists a rep envelopes newest first and validates rep IDs', async () => {
  const dependencies = fixture();
  let requestedRepId;
  dependencies.storage.listRepEnvelopes = async (repId) => {
    requestedRepId = repId;
    return ({
    rep: { repId: 'gustavoprietop@gmail.com', type: 'signer', email: 'gustavoprietop@gmail.com', name: 'Gustavo Prieto' },
    envelopes: [
      { envelopeId: 'old', completedAt: '2026-01-01', primaryDocumentName: 'Old.pdf' },
      { envelopeId: 'new', completedAt: '2026-08-20', primaryDocumentName: 'New.pdf' },
    ],
    });
  };
  const response = await invoke(dependencies, { method: 'GET', url: '/api/reps/GustavoPrietoP%40GMAIL.com/envelopes' });
  assert.equal(response.status, 200);
  assert.equal(requestedRepId, 'gustavoprietop@gmail.com');
  assert.deepEqual(response.body.envelopes.map((item) => item.envelopeId), ['new', 'old']);
  const invalid = await invoke(dependencies, { method: 'GET', url: '/api/reps/not-an-email/envelopes' });
  assert.equal(invalid.status, 400);
});

test('returns envelope detail and handles missing or corrupted metadata safely', async () => {
  const dependencies = fixture();
  dependencies.storage.getEnvelope = async () => ({ envelopeId: 'env-1', status: 'completed', documents: [] });
  const found = await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/env-1' });
  assert.equal(found.status, 200);
  dependencies.storage.getEnvelope = async () => undefined;
  assert.equal((await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/missing' })).status, 404);
  dependencies.storage.getEnvelope = async () => { throw new Error('Corrupted envelope metadata'); };
  const corrupted = await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/env-1' });
  assert.equal(corrupted.status, 500);
  assert.deepEqual(corrupted.body, { error: 'Corrupted envelope metadata' });
});

test('streams only document IDs validated against envelope metadata', async () => {
  const dependencies = fixture();
  dependencies.storage.getDocument = async (_envelopeId, documentId) => documentId === '1' ? {
    document: { documentId: '1', name: 'Application.pdf' },
    body: [Buffer.from('pdf-bytes')],
    contentLength: 9,
    contentType: 'application/pdf',
  } : undefined;
  const found = await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/env-1/documents/1?download=true' });
  assert.equal(found.status, 200);
  assert.equal(found.headers['content-disposition'], 'attachment; filename="Application.pdf"');
  assert.equal(found.body, 'pdf-bytes');
  assert.equal((await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/env-1/documents/unknown' })).status, 404);
  assert.equal((await invoke(dependencies, { method: 'GET', url: '/api/docusign/envelopes/env-1/documents/%2Fetc' })).status, 400);
});

test('serves the rep-centric documents application routes', async () => {
  const dependencies = fixture();
  for (const url of ['/documents', '/documents/reps/john%40capital-infusion.com', '/documents/envelopes/env-1']) {
    const response = await invoke(dependencies, { method: 'GET', url });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(response.body.includes('Contract Management'), true);
  }
});
