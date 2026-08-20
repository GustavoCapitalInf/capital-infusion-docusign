import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletedEnvelopeProcessor } from '../src/docusign/processor.js';

function fixture(envelope, recipients = { signers: [] }) {
  let savedMetadata;
  let recipientRequests = 0;
  const updates = [];
  const client = {
    getEnvelope: async () => envelope,
    listRecipients: async () => { recipientRequests += 1; return recipients; },
    listDocuments: async () => [],
    downloadDocument: async () => { throw new Error('not expected'); },
  };
  const storage = {
    saveEnvelope: async (_envelopeId, _documents, metadata) => { savedMetadata = metadata; return []; },
    updateEvent: async (_file, update) => updates.push(update),
    releaseClaim: async () => {},
  };
  const logger = { info() {}, warn() {}, error() {} };
  const processor = new CompletedEnvelopeProcessor({
    client,
    storage,
    allowedSenders: new Set(['hr@capital-infusion.com']),
    logger,
  });
  return { processor, updates, metadata: () => savedMetadata, recipientRequests: () => recipientRequests };
}

test('keeps HR as sender and uses the completed signer as rep', async () => {
  const context = fixture({
    status: 'completed',
    completedDateTime: '2026-08-20T00:09:02Z',
    sender: { email: 'HR@capital-infusion.com', userName: 'Human Resources' },
  }, {
    signers: [{ email: 'GustavoPrietoP@GMAIL.com', name: 'Gustavo Prieto', status: 'completed' }],
    carbonCopies: [{ email: 'audit@capital-infusion.com', status: 'completed' }],
  });
  await context.processor.process(
    { envelopeId: 'env-1', senderEmail: 'wrong@capital-infusion.com', timestamp: '2026-08-20T00:09:03Z' },
    { file: 'event', lock: 'lock' },
  );
  assert.deepEqual(context.metadata().sender, {
    email: 'hr@capital-infusion.com',
    name: 'Human Resources',
  });
  assert.deepEqual(context.metadata().rep, {
    repId: 'gustavoprietop@gmail.com',
    type: 'signer',
    email: 'gustavoprietop@gmail.com',
    name: 'Gustavo Prieto',
  });
  assert.equal(context.metadata().repSource, 'completed_signer');
  assert.equal(context.updates.at(-1).status, 'processed');
});

test('enforces the sender allowlist before retrieving recipients or documents', async () => {
  const context = fixture({
    status: 'completed',
    sender: { email: 'unauthorized@example.com' },
  }, { signers: [{ email: 'rep@example.com', status: 'completed' }] });
  await context.processor.process(
    { envelopeId: 'env-unapproved', timestamp: '2026-08-20T00:09:03Z' },
    { file: 'event', lock: 'lock' },
  );
  assert.equal(context.metadata(), undefined);
  assert.equal(context.recipientRequests(), 0);
  assert.equal(context.updates.at(-1).status, 'ignored');
  assert.equal(context.updates.at(-1).reason, 'sender-not-allowed');
});
