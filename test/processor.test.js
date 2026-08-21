import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletedEnvelopeProcessor } from '../src/docusign/processor.js';

function fixture(envelope, recipients = { signers: [] }, listedDocuments = []) {
  let savedMetadata;
  let recipientRequests = 0;
  const updates = [];
  const contractEnvelopes = [];
  const client = {
    getEnvelope: async () => envelope,
    listRecipients: async () => { recipientRequests += 1; return recipients; },
    listDocuments: async () => listedDocuments,
    downloadDocument: async () => Buffer.from('pdf'),
  };
  const storage = {
    saveEnvelope: async (_envelopeId, documents, metadata) => {
      savedMetadata = metadata;
      return documents.map(({ contents: _contents, ...document }) => document);
    },
    updateEvent: async (_file, update) => updates.push(update),
    releaseClaim: async () => {},
  };
  const logger = { info() {}, warn() {}, error() {} };
  const processor = new CompletedEnvelopeProcessor({
    client,
    storage,
    allowedSenders: new Set(['hr@capital-infusion.com']),
    contractLifecycle: { recordCompletedEnvelope: async (value) => contractEnvelopes.push(value) },
    logger,
  });
  return { processor, updates, metadata: () => savedMetadata, recipientRequests: () => recipientRequests, contractEnvelopes };
}

test('keeps HR as sender and uses the completed signer as rep', async () => {
  const context = fixture({
    status: 'completed',
    completedDateTime: '2026-08-20T00:09:02Z',
    sender: { email: 'HR@capital-infusion.com', userName: 'Human Resources' },
  }, {
    signers: [
      { email: 'hr@capital-infusion.com', name: 'Human Resources', status: 'completed' },
      { email: 'GustavoPrietoP@GMAIL.com', name: 'Gustavo Prieto', status: 'completed' },
    ],
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

test('passes stored documents and authoritative completion time into contract activation', async () => {
  const context = fixture({
    status: 'completed',
    completedDateTime: '2026-08-20T00:09:02Z',
    sender: { email: 'hr@capital-infusion.com' },
  }, {
    signers: [{ email: 'rep@example.com', name: 'Example Rep', status: 'completed' }],
  }, [
    { documentId: '1', name: 'Capital_Infusion_IC_Account_Executive_Agreement (ER).pdf', type: 'content' },
    { documentId: '2', name: 'W9.pdf', type: 'content' },
  ]);
  await context.processor.process(
    { envelopeId: 'contract-envelope', timestamp: '2026-08-20T00:10:00Z' },
    { file: 'event', lock: 'lock' },
  );
  assert.equal(context.contractEnvelopes.length, 1);
  assert.equal(context.contractEnvelopes[0].rep.repId, 'rep@example.com');
  assert.equal(context.contractEnvelopes[0].completedAt, '2026-08-20T00:09:02Z');
  assert.deepEqual(context.contractEnvelopes[0].documents.map((document) => document.name), [
    'Capital_Infusion_IC_Account_Executive_Agreement (ER).pdf', 'W9.pdf',
  ]);
});
