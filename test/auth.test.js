import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { DocusignAuthError, DocusignJwtAuth } from '../src/docusign/auth.js';

test('creates and exchanges a signed JWT grant without exposing the key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let request;
  const auth = new DocusignJwtAuth({
    integrationKey: 'integration-key',
    userId: 'user-guid',
    accountId: 'account-guid',
    privateKeyPath: '/not-read',
    authServer: 'account-d.docusign.com',
    baseUrl: 'https://demo.docusign.net',
  }, {
    now: () => 1_700_000_000,
    readFile: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ access_token: 'secret-access-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(await auth.getAccessToken(), 'secret-access-token');
  assert.equal(await auth.getAccessToken(), 'secret-access-token');
  assert.equal(request.url, 'https://account-d.docusign.com/oauth/token');
  const assertion = request.options.body.get('assertion');
  const [header, claims, signature] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), {
    iss: 'integration-key',
    sub: 'user-guid',
    aud: 'account-d.docusign.com',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    scope: 'signature impersonation',
  });
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')), true);
});

test('tests JWT authentication and returns only selected userinfo account fields', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const requests = [];
  const auth = new DocusignJwtAuth({
    integrationKey: 'integration-key',
    userId: 'user-guid',
    accountId: 'selected-account',
    privateKeyPath: '/secret.key',
    authServer: 'account-d.docusign.com',
  }, {
    readFile: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'never-return-this-token', expires_in: 3600 });
      }
      return Response.json({
        sub: 'do-not-return-user-profile',
        accounts: [
          { account_id: 'other-account', account_name: 'Other', base_uri: 'https://other.example', is_default: true },
          { account_id: 'selected-account', account_name: 'Capital Infusion', base_uri: 'https://demo.docusign.net' },
        ],
      });
    },
  });

  assert.deepEqual(await auth.testAuthentication(), {
    accountId: 'selected-account',
    accountName: 'Capital Infusion',
    baseUri: 'https://demo.docusign.net',
    privateKeyLoaded: true,
    privateKeyParsed: true,
  });
  assert.equal(requests[1].url, 'https://account-d.docusign.com/oauth/userinfo');
  assert.equal(requests[1].options.headers.authorization, 'Bearer never-return-this-token');
});

test('returns a safe error code when the RSA key file is missing', async () => {
  const auth = new DocusignJwtAuth({
    integrationKey: 'integration-key',
    userId: 'user-guid',
    privateKeyPath: '/missing.key',
    authServer: 'account-d.docusign.com',
  }, {
    readFile: async () => { throw Object.assign(new Error('sensitive filesystem detail'), { code: 'ENOENT' }); },
  });
  await assert.rejects(auth.testAuthentication(), (error) => {
    assert.equal(error instanceof DocusignAuthError, true);
    assert.equal(error.code, 'private_key_not_found');
    assert.equal(error.message, 'DocuSign RSA private key file not found');
    assert.equal(error.privateKeyLoaded, false);
    return true;
  });
});

test('preserves safe DocuSign OAuth errors without exposing the assertion', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const auth = new DocusignJwtAuth({
    integrationKey: 'integration-key',
    userId: 'user-guid',
    privateKeyPath: '/secret.key',
    authServer: 'account-d.docusign.com',
  }, {
    readFile: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetch: async () => Response.json({ error: 'consent_required', error_description: 'Consent is required' }, { status: 400 }),
  });
  await assert.rejects(auth.testAuthentication(), (error) => {
    assert.equal(error.code, 'consent_required');
    assert.equal(error.message, 'Consent is required');
    assert.equal(error.privateKeyParsed, true);
    return true;
  });
});
