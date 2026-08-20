import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletedEnvelopeProcessor } from '../src/docusign/processor.js';

function fixture(envelope) {
  let savedMetadata;
  const updates = [];
  const client = {
    getEnvelope: async () => envelope,
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
    repEmailDomain: 'capital-infusion.com',
    logger,
  });
  return { processor, updates, metadata: () => savedMetadata };
}

test('uses authoritative DocuSign sender email and display name as the rep', async () => {
  const context = fixture({
    status: 'completed',
    completedDateTime: '2026-08-20T00:09:02Z',
    sender: { email: 'JOHN@capital-infusion.com', userName: 'John Smith' },
  });
  await context.processor.process(
    { envelopeId: 'env-1', senderEmail: 'wrong@capital-infusion.com', timestamp: '2026-08-20T00:09:03Z' },
    { file: 'event', lock: 'lock' },
  );
  assert.deepEqual(context.metadata().rep, {
    repId: 'john@capital-infusion.com',
    type: 'internal',
    email: 'john@capital-infusion.com',
    name: 'John Smith',
  });
  assert.equal(context.updates.at(-1).status, 'processed');
});

test('stores external senders as unassigned instead of discarding the envelope', async () => {
  const context = fixture({
    status: 'completed',
    completedDateTime: '2026-08-20T00:09:02Z',
    sender: { email: 'customer@gmail.com', userName: 'Customer' },
  });
  await context.processor.process(
    { envelopeId: 'env-external', timestamp: '2026-08-20T00:09:03Z' },
    { file: 'event', lock: 'lock' },
  );
  assert.equal(context.metadata().rep.repId, 'unassigned');
  assert.equal(context.metadata().rep.type, 'unassigned');
  assert.equal(context.updates.at(-1).status, 'processed');
});
