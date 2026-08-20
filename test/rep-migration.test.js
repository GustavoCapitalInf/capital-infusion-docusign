import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSignerRepMetadata } from '../src/docusign/rep-migration.js';

test('migrates legacy sender-based metadata using authoritative completed signers', async () => {
  const updates = [];
  let rebuilds = 0;
  const storage = {
    listEnvelopeMetadataRecords: async () => [{
      envelopeId: 'legacy-envelope',
      senderEmail: 'HR@capital-infusion.com',
      rep: { repId: 'hr@capital-infusion.com', name: 'HR' },
    }],
    updateEnvelopeIdentity: async (envelopeId, identity) => updates.push({ envelopeId, identity }),
    rebuildIndexes: async () => { rebuilds += 1; },
  };
  const client = {
    listRecipients: async () => ({
      signers: [{ email: 'GustavoPrietoP@GMAIL.com', name: 'Gustavo Prieto', status: 'completed' }],
      carbonCopies: [{ email: 'audit@example.com', status: 'completed' }],
    }),
  };
  const result = await migrateSignerRepMetadata({
    client,
    storage,
    logger: { warn() {} },
  });
  assert.deepEqual(result, { scanned: 1, migrated: 1, failed: 0 });
  assert.equal(rebuilds, 1);
  assert.deepEqual(updates[0], {
    envelopeId: 'legacy-envelope',
    identity: {
      sender: { email: 'hr@capital-infusion.com', name: undefined },
      rep: {
        repId: 'gustavoprietop@gmail.com',
        type: 'signer',
        email: 'gustavoprietop@gmail.com',
        name: 'Gustavo Prieto',
      },
      recipientResolution: { status: 'resolved', completedSignerCount: 1 },
    },
  });
});

test('skips metadata already sourced from a completed signer', async () => {
  let recipientRequests = 0;
  const result = await migrateSignerRepMetadata({
    client: { listRecipients: async () => { recipientRequests += 1; } },
    storage: {
      listEnvelopeMetadataRecords: async () => [{ envelopeId: 'current', repSource: 'completed_signer' }],
      updateEnvelopeIdentity: async () => { throw new Error('not expected'); },
      rebuildIndexes: async () => {},
    },
    logger: { warn() {} },
  });
  assert.equal(recipientRequests, 0);
  assert.deepEqual(result, { scanned: 1, migrated: 0, failed: 0 });
});
