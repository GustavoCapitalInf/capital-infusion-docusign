import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { documentFilename, FileStorage, classifyDocument } from '../src/docusign/storage.js';

test('claims an event once and persists documents with safe, distinct metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docusign-storage-'));
  const storage = new FileStorage(root);
  const event = { provider: 'docusign', event: 'envelope-completed', envelopeId: 'env/123' };
  const first = await storage.claim(event);
  const duplicate = await storage.claim(event);
  assert.equal(first.claimed, true);
  assert.equal(duplicate.claimed, false);
  await storage.releaseClaim(first.lock);

  const saved = await storage.saveEnvelope(event.envelopeId, [
    { documentId: '1', name: '../../Offer Letter.pdf', type: 'content', category: 'application', contents: Buffer.from('pdf') },
    { documentId: 'certificate', name: 'Summary.pdf', type: 'summary', category: 'certificate', contents: Buffer.from('cert') },
  ], { status: 'completed' });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].storedName.includes('..'), false);
  assert.equal(saved[0].storedName.endsWith('.pdf'), true);
  const metadata = JSON.parse(await readFile(path.join(root, 'envelopes', 'env_123', 'metadata.json')));
  assert.equal(metadata.documents[1].category, 'certificate');
});

test('reclaims an interrupted local processing event after lock release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'docusign-storage-retry-'));
  const storage = new FileStorage(root);
  const event = { provider: 'docusign', event: 'envelope-completed', envelopeId: 'env-retry' };
  const interrupted = await storage.claim(event);
  await storage.releaseClaim(interrupted.lock);
  const retry = await storage.claim(event);
  assert.equal(retry.claimed, true);
  const record = JSON.parse(await readFile(retry.file));
  assert.equal(record.retryCount, 1);
  await storage.releaseClaim(retry.lock);
});

test('classifies application, certificate, and supplemental files', () => {
  assert.equal(classifyDocument({ type: 'content', name: 'Agreement.pdf' }), 'application');
  assert.equal(classifyDocument({ type: 'summary', name: 'Summary.pdf' }), 'certificate');
  assert.equal(classifyDocument({ type: 'attachment', name: 'Attachment.pdf' }), 'supplemental');
});

test('generates safe, deterministic document filenames', () => {
  assert.equal(documentFilename({ documentId: '1', name: '../../Offer Letter.pdf' }), '1-Offer_Letter.pdf');
  assert.equal(documentFilename({ documentId: 'certificate', name: 'Summary' }), 'certificate-Summary.pdf');
});
