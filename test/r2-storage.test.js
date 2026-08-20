import test from 'node:test';
import assert from 'node:assert/strict';
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
      return { Body: object.Body, ETag: object.ETag };
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
    senderEmail: 'sender@example.com',
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
