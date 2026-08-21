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
  assert.deepEqual(result, {
    scanned: 1,
    migrated: 1,
    failed: 0,
    unresolvedBefore: 0,
    unresolvedAfter: 0,
  });
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
      recipientResolution: {
        status: 'resolved',
        completedSignerCount: 1,
        externalSignerCount: 1,
        internalSignerCount: 0,
        resolverVersion: 2,
      },
    },
  });
});

test('skips metadata already processed by the current resolver', async () => {
  let recipientRequests = 0;
  const result = await migrateSignerRepMetadata({
    client: { listRecipients: async () => { recipientRequests += 1; } },
    storage: {
      listEnvelopeMetadataRecords: async () => [{
        envelopeId: 'current',
        repSource: 'completed_signer',
        recipientResolution: { status: 'resolved', resolverVersion: 2 },
      }],
      updateEnvelopeIdentity: async () => { throw new Error('not expected'); },
      rebuildIndexes: async () => {},
    },
    logger: { warn() {} },
  });
  assert.equal(recipientRequests, 0);
  assert.deepEqual(result, {
    scanned: 1,
    migrated: 0,
    failed: 0,
    unresolvedBefore: 0,
    unresolvedAfter: 0,
  });
});

test('idempotently reprocesses an existing unresolved HR plus representative envelope', async () => {
  let metadata = {
    envelopeId: 'unresolved-envelope',
    repSource: 'completed_signer',
    rep: { repId: 'requires-resolution', type: 'requires_resolution', name: 'Rep Resolution Required' },
    recipientResolution: { status: 'requires_resolution', completedSignerCount: 2 },
  };
  let recipientRequests = 0;
  const storage = {
    listEnvelopeMetadataRecords: async () => [metadata],
    updateEnvelopeIdentity: async (_envelopeId, identity) => {
      metadata = { ...metadata, ...identity, repSource: 'completed_signer' };
    },
    rebuildIndexes: async () => {},
  };
  const client = { listRecipients: async () => {
    recipientRequests += 1;
    return { signers: [
      { email: 'hr@capital-infusion.com', status: 'completed' },
      { email: 'nathalia@example.com', name: 'Nathalia Nava', status: 'completed' },
    ] };
  } };
  const dependencies = {
    client,
    storage,
    internalSigners: new Set(['hr@capital-infusion.com']),
    logger: { warn() {} },
  };

  assert.deepEqual(await migrateSignerRepMetadata(dependencies), {
    scanned: 1,
    migrated: 1,
    failed: 0,
    unresolvedBefore: 1,
    unresolvedAfter: 0,
  });
  assert.equal(metadata.rep.repId, 'nathalia@example.com');
  assert.deepEqual(await migrateSignerRepMetadata(dependencies), {
    scanned: 1,
    migrated: 0,
    failed: 0,
    unresolvedBefore: 0,
    unresolvedAfter: 0,
  });
  assert.equal(recipientRequests, 1);
});
