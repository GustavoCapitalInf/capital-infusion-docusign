import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertApiConfiguration,
  assertR2Configuration,
  loadConfig,
  missingApiConfiguration,
} from '../src/config.js';

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
  assert.equal(config.docusign.environment, 'demo');
  assert.deepEqual([...config.docusign.internalSigners], ['hr@capital-infusion.com']);
});

test('infers production DocuSign and loads optional demo metadata IDs', () => {
  const config = loadConfig({
    DOCUSIGN_AUTH_SERVER: 'account.docusign.com',
    DOCUSIGN_BASE_URL: 'https://na4.docusign.net',
    DOCUSIGN_DEMO_ENVELOPE_IDS: 'demo-1, demo-2',
    DOCUSIGN_DEMO_ACCOUNT_IDS: 'account-demo',
  });
  assert.equal(config.docusign.environment, 'production');
  assert.deepEqual([...config.docusign.demoEnvelopeIds], ['demo-1', 'demo-2']);
  assert.deepEqual([...config.docusign.demoAccountIds], ['account-demo']);
  assert.throws(() => loadConfig({ DOCUSIGN_ENVIRONMENT: 'staging' }), /must be demo or production/);
});

test('loads exact internal signer emails without creating a domain-wide exclusion', () => {
  const config = loadConfig({
    DOCUSIGN_INTERNAL_SIGNERS: ' HR@capital-infusion.com, submissions@capital-infusion.com ',
  });
  assert.deepEqual([...config.docusign.internalSigners], [
    'hr@capital-infusion.com',
    'submissions@capital-infusion.com',
  ]);
});

test('reports missing R2 configuration without exposing configured values', () => {
  const config = loadConfig({ R2_BUCKET_NAME: 'private-bucket' });
  assert.throws(
    () => assertR2Configuration(config.r2),
    /Missing required R2 environment variables: R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
  );
});

test('uses Render PORT when provided', () => {
  assert.equal(loadConfig({ PORT: '10000' }).port, 10000);
});

test('loads contract reminder configuration without hardcoded provider secrets', () => {
  const config = loadConfig({
    CONTRACT_NOTIFICATION_EMAIL: ' notify@example.com ',
    CONTRACT_POWER_AUTOMATE_URL: ' https://example.invalid/flow?sig=secret ',
  });
  assert.deepEqual(config.contracts, {
    notificationEmail: 'notify@example.com',
    emailProvider: 'power-automate',
    powerAutomateUrl: 'https://example.invalid/flow?sig=secret',
    emailFrom: '',
    resendApiKey: '',
  });
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
