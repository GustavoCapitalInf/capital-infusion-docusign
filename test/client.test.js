import test from 'node:test';
import assert from 'node:assert/strict';
import { DocusignClient } from '../src/docusign/client.js';

test('retrieves authoritative envelope recipients from the DocuSign recipients endpoint', async () => {
  let request;
  const client = new DocusignClient({
    baseUrl: 'https://demo.docusign.net',
    accountId: 'account-id',
  }, {
    getAccessToken: async () => 'test-token',
  }, {
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ signers: [{ email: 'rep@example.com', status: 'completed' }] }),
      };
    },
  });
  const recipients = await client.listRecipients('envelope-id');
  assert.equal(request.url, 'https://demo.docusign.net/restapi/v2.1/accounts/account-id/envelopes/envelope-id/recipients');
  assert.equal(request.options.headers.accept, 'application/json');
  assert.equal(recipients.signers[0].email, 'rep@example.com');
});
