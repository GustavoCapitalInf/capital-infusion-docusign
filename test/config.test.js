import test from 'node:test';
import assert from 'node:assert/strict';
import { assertApiConfiguration, loadConfig, missingApiConfiguration } from '../src/config.js';

test('uses local port defaults and trims Render environment values', () => {
  const config = loadConfig({
    DOCUSIGN_INTEGRATION_KEY: ' key-with-space ',
    DOCUSIGN_ACCOUNT_ID: ' account-with-space ',
    DOCUSIGN_AUTH_SERVER: ' account-d.docusign.com ',
  });
  assert.equal(config.port, 3000);
  assert.equal(config.docusign.integrationKey, 'key-with-space');
  assert.equal(config.docusign.accountId, 'account-with-space');
  assert.equal(config.docusign.authServer, 'account-d.docusign.com');
});

test('uses Render PORT when provided', () => {
  assert.equal(loadConfig({ PORT: '10000' }).port, 10000);
});

test('reports missing variable names without values', () => {
  const config = loadConfig({ DOCUSIGN_USER_ID: 'user-guid' }).docusign;
  assert.deepEqual(missingApiConfiguration(config), [
    'DOCUSIGN_INTEGRATION_KEY',
    'DOCUSIGN_ACCOUNT_ID',
    'DOCUSIGN_PRIVATE_KEY_PATH',
  ]);
  assert.throws(
    () => assertApiConfiguration(config),
    /Missing required environment variables: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_PRIVATE_KEY_PATH/,
  );
});
