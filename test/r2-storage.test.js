import test from 'node:test';
import assert from 'node:assert/strict';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { loadConfig, missingR2Configuration } from '../src/config.js';
import { R2Storage } from '../src/docusign/r2-storage.js';
import { createStorageProvider } from '../src/docusign/storage-provider.js';

function preconditionFailed() {
  return Object.assign(new Error('condition failed'), {
    name: 'PreconditionFailed',
    $metadata: { httpStatusCode: 412 },
  });
}

function notFound() {
  return Object.assign(new Error('not found'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
}

class MemoryS3Client {
  constructor() {
    this.objects = new Map();
    this.commands = [];
    this.counter = 0;
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    this.commands.push({ name, input });
    if (name === 'PutObjectCommand') {
      const existing = this.objects.get(input.Key);
      if (input.IfNoneMatch === '*' && existing) throw preconditionFailed();
      if (input.IfMatch && input.IfMatch !== existing?.ETag) throw preconditionFailed();
      const ETag = `"etag-${++this.counter}"`;
      this.objects.set(input.Key, {
        Body: Buffer.from(input.Body),
        ContentType: input.ContentType,
        ETag,
        LastModified: new Date(),
      });
      return { ETag };
    }
    if (name === 'GetObjectCommand') {
      const object = this.objects.get(input.Key);
      if (!object) throw notFound();
      return { Body: object.Body, ETag: object.ETag, ContentLength: object.Body.length, ContentType: object.ContentType };
    }
    if (name === 'HeadObjectCommand') {
      const object = this.objects.get(input.Key);
      if (!object) throw notFound();
      return { ETag: object.ETag, LastModified: object.LastModified, ContentLength: object.Body.length };
    }
    if (name === 'DeleteObjectCommand') {
      this.objects.delete(input.Key);
      return {};
    }
    if (name === 'ListObjectsV2Command') {
      const prefixes = new Set();
      for (const key of this.objects.keys()) {
        if (!key.startsWith(input.Prefix)) continue;
        const remainder = key.slice(input.Prefix.length);
        const first = remainder.split(input.Delimiter)[0];
        if (first) prefixes.add(`${input.Prefix}${first}${input.Delimiter}`);
      }
      return { CommonPrefixes: [...prefixes].map((Prefix) => ({ Prefix })), IsTruncated: false };
    }
    throw new Error(`Unexpected command ${name}`);
  }
}

function completeR2Environment() {
  return {
    R2_ACCOUNT_ID: 'account-id',
    R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
    R2_BUCKET_NAME: 'private-bucket',
    R2_ACCESS_KEY_ID: 'access-id',
    R2_SECRET_ACCESS_KEY: 'secret-key',
  };
}

test('validates R2 configuration and selects providers explicitly', () => {
  const localConfig = loadConfig({});
  assert.equal(createStorageProvider(localConfig).provider, 'filesystem');

  const incomplete = loadConfig({ R2_BUCKET_NAME: 'private-bucket' });
  assert.deepEqual(missingR2Configuration(incomplete.r2), [
    'R2_ACCOUNT_ID',
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ]);
  assert.throws(() => createStorageProvider(incomplete), /Missing required R2 environment variables/);

  const client = new MemoryS3Client();
  const r2 = createStorageProvider(loadConfig(completeR2Environment()), { r2Client: client });
  assert.equal(r2.provider, 'r2');
  assert.equal(r2.bucket, 'private-bucket');
});

test('uploads signed documents, certificates, supplemental files, and safe metadata keys', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({
    client,
    bucket: 'private-bucket',
    now: () => new Date('2026-08-19T12:00:00Z'),
  });
  const envelopeId = 'env/unsafe';
  const saved = await storage.saveEnvelope(envelopeId, [
    { documentId: '1', name: '../../Offer Letter.pdf', type: 'content', category: 'application', contents: Buffer.from('signed') },
    { documentId: 'certificate', name: 'Summary', type: 'summary', category: 'certificate', contents: Buffer.from('certificate') },
    { documentId: '2', name: 'Evidence.txt', type: 'attachment', category: 'supplemental', contents: Buffer.from('extra') },
  ], {
    status: 'completed',
    senderEmail: 'john@capital-infusion.com',
    rep: { repId: 'john@capital-infusion.com', type: 'internal', email: 'john@capital-infusion.com', name: 'John Smith' },
    eventTimestamp: '2026-08-19T11:59:00Z',
  });

  assert.deepEqual(saved.map((document) => document.classification), [
    'signed_document',
    'certificate',
    'supplemental',
  ]);
  assert.deepEqual(saved.map((document) => document.objectKey), [
    'docusign/envelopes/env_unsafe/documents/1-Offer_Letter.pdf',
    'docusign/envelopes/env_unsafe/documents/certificate-Summary.pdf',
    'docusign/envelopes/env_unsafe/documents/2-Evidence.txt',
  ]);
  const metadataKey = 'docusign/envelopes/env_unsafe/metadata.json';
  const metadata = JSON.parse(client.objects.get(metadataKey).Body.toString());
  assert.equal(metadata.status, 'completed');
  assert.equal(metadata.documents[0].classification, 'signed_document');
  assert.equal(metadata.documents[1].objectKey, saved[1].objectKey);
  assert.equal(JSON.stringify(metadata).includes('secret-key'), false);
  assert.equal(client.commands.some(({ input }) => input.ACL !== undefined), false);

  await storage.saveEnvelope(envelopeId, [
    { documentId: '1', name: '../../Offer Letter.pdf', type: 'content', category: 'application', contents: Buffer.from('signed') },
  ], {
    status: 'completed',
    senderEmail: 'john@capital-infusion.com',
    rep: { repId: 'john@capital-infusion.com', type: 'internal', email: 'john@capital-infusion.com', name: 'John Smith' },
    eventTimestamp: '2026-08-19T11:59:00Z',
  });
  const repIndex = JSON.parse(client.objects.get('docusign/reps/john%40capital-infusion.com/index.json').Body);
  assert.equal(repIndex.envelopes.length, 1);
});

test('lists reps, rep envelopes, global envelopes, details, and validated private documents', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  await storage.saveEnvelope('env-1', [
    { documentId: '1', name: 'Application.pdf', type: 'content', category: 'application', contents: Buffer.from('private-pdf') },
    { documentId: 'certificate', name: 'Summary', type: 'summary', category: 'certificate', contents: Buffer.from('certificate') },
  ], {
    status: 'completed',
    senderEmail: 'john@capital-infusion.com',
    rep: { repId: 'john@capital-infusion.com', type: 'internal', email: 'john@capital-infusion.com', name: 'John Smith' },
    completedDateTime: '2026-08-20T00:09:02Z',
  });
  const reps = await storage.listReps();
  assert.equal(reps[0].completedEnvelopeCount, 1);
  const group = await storage.listRepEnvelopes('john@capital-infusion.com');
  assert.equal(group.envelopes[0].primaryDocumentName, 'Application.pdf');
  assert.equal((await storage.listEnvelopes())[0].rep.name, 'John Smith');
  const envelope = await storage.getEnvelope('env-1');
  assert.deepEqual(envelope.documents.map((item) => item.classification), ['signed_document', 'certificate']);
  assert.equal(envelope.documents.some((item) => item.objectKey || item.storedName), false);
  const document = await storage.getDocument('env-1', '1');
  assert.equal(document.contentLength, 11);
  assert.equal(document.document.name, 'Application.pdf');
  assert.equal(await storage.getDocument('env-1', '../../secret'), undefined);
  assert.equal(await storage.getEnvelope('missing'), undefined);
});

test('backfills rep indexes from existing envelope metadata without reading PDFs', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  await client.send(new PutObjectCommand({
    Bucket: 'private-bucket',
    Key: 'docusign/envelopes/legacy-envelope/metadata.json',
    Body: JSON.stringify({
      envelopeId: 'legacy-envelope',
      envelope: { status: 'completed', senderEmail: 'legacy.rep@capital-infusion.com', completedDateTime: '2026-07-01' },
      documents: [{ documentId: '1', originalName: 'Legacy.pdf', category: 'application', storedName: '1-Legacy.pdf' }],
    }),
  }));
  const reps = await storage.listReps();
  assert.equal(reps[0].repId, 'legacy.rep@capital-infusion.com');
  assert.equal(reps[0].name, 'Legacy Rep');
  const documentReads = client.commands.filter(({ name, input }) => name === 'GetObjectCommand' && input.Key.includes('/documents/'));
  assert.equal(documentReads.length, 0);
});

test('handles unassigned reps and corrupted metadata safely', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  await storage.saveEnvelope('external-env', [], {
    status: 'completed',
    senderEmail: 'external@gmail.com',
    rep: { repId: 'unassigned', type: 'unassigned', email: 'external@gmail.com', name: 'Unknown Rep' },
    completedDateTime: '2026-08-20',
  });
  assert.equal((await storage.listReps())[0].repId, 'unassigned');
  assert.equal((await storage.listReps())[0].email, undefined);
  client.objects.set('docusign/envelopes/broken/metadata.json', {
    Body: Buffer.from('{broken'), ETag: '"broken"', LastModified: new Date(), ContentType: 'application/json',
  });
  await assert.rejects(storage.getEnvelope('broken'), /Corrupted envelope metadata/);
});

test('uses conditional R2 locks to prevent duplicate event processing', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  const event = { provider: 'docusign', event: 'envelope-completed', envelopeId: 'env-123' };
  const first = await storage.claim(event);
  assert.equal(first.claimed, true);
  await storage.updateEvent(first.file, { status: 'processed', processedAt: new Date().toISOString() });
  await storage.releaseClaim(first.lock);
  const duplicate = await storage.claim(event);
  assert.equal(duplicate.claimed, false);
  const conditionalLockWrites = client.commands.filter(
    ({ name, input }) => name === 'PutObjectCommand' && input.Key.endsWith('.lock'),
  );
  assert.equal(conditionalLockWrites.every(({ input }) => input.IfNoneMatch === '*'), true);
});

test('retries an interrupted processing record after its lock is released', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  const event = { provider: 'docusign', event: 'envelope-completed', envelopeId: 'env-interrupted' };
  const interrupted = await storage.claim(event);
  await storage.releaseClaim(interrupted.lock);
  const retry = await storage.claim(event);
  assert.equal(retry.claimed, true);
  const record = JSON.parse(client.objects.get(retry.file).Body.toString());
  assert.equal(record.retryCount, 1);
  await storage.releaseClaim(retry.lock);
});

test('connectivity test uploads, reads, and deletes its temporary object', async () => {
  const client = new MemoryS3Client();
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  assert.deepEqual(await storage.testConnectivity(), {
    success: true,
    provider: 'r2',
    bucket: 'private-bucket',
    upload: true,
    read: true,
    delete: true,
  });
  assert.equal([...client.objects.keys()].some((key) => key.startsWith('healthchecks/')), false);
});

test('returns safe R2 authentication errors without credential values', async () => {
  const client = {
    send: async () => {
      throw Object.assign(new Error('request included secret-key'), { $metadata: { httpStatusCode: 403 } });
    },
  };
  const storage = new R2Storage({ client, bucket: 'private-bucket' });
  await assert.rejects(storage.testConnectivity(), (error) => {
    assert.equal(error.code, 'r2_authentication_failure');
    assert.equal(error.message, 'Cloudflare R2 authentication failed');
    assert.equal(error.message.includes('secret-key'), false);
    return true;
  });
});
