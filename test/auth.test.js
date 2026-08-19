import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { DocusignJwtAuth } from '../src/docusign/auth.js';

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
