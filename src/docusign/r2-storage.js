import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { documentFilename, metadataClassification, safeSegment } from './storage.js';
import { normalizeEnvelopeMetadata, publicEnvelope, repSummary, upsertEnvelope } from './catalog.js';

const LOCK_MAX_AGE_MS = 15 * 60 * 1000;
const CATALOG_SCHEMA_VERSION = 2;

function isNotFound(error) {
  return ['NoSuchKey', 'NotFound'].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error) {
  return error?.name === 'PreconditionFailed' || error?.$metadata?.httpStatusCode === 412;
}

function storageError(code, message, cause) {
  const error = new Error(message, { cause });
  error.name = 'R2StorageError';
  error.code = code;
  return error;
}

function stageError(error, stage) {
  if (error?.name === 'R2StorageError') return error;
  if ([401, 403].includes(error?.$metadata?.httpStatusCode)) {
    return storageError('r2_authentication_failure', 'Cloudflare R2 authentication failed', error);
  }
  return storageError(`r2_${stage}_failure`, `Cloudflare R2 ${stage.replaceAll('_', ' ')} failed`, error);
}

async function bodyToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') return body.transformToString('utf8');
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export class R2Storage {
  constructor({ client, bucket, prefix = 'docusign', now = () => new Date() }) {
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix.replace(/^\/+|\/+$/g, '');
    this.now = now;
    this.provider = 'r2';
    this.catalogQueue = Promise.resolve();
  }

  eventKey(event) {
    const digest = createHash('sha256').update(`${event.provider}:${event.envelopeId}:${event.event}`).digest('hex');
    return `${this.prefix}/events/${digest}.json`;
  }

  async put(key, body, options = {}) {
    return this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ...options,
    }));
  }

  async getJson(key) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return JSON.parse(await bodyToString(response.Body));
  }

  async getJsonRecord(key) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { value: JSON.parse(await bodyToString(response.Body)), etag: response.ETag, exists: true };
    } catch (error) {
      if (isNotFound(error)) return { value: undefined, etag: undefined, exists: false };
      throw error;
    }
  }

  async updateJsonIndex(key, initialValue, mutate) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.getJsonRecord(key);
      const next = mutate(current.value || structuredClone(initialValue));
      try {
        await this.put(key, `${JSON.stringify(next, null, 2)}\n`, {
          ContentType: 'application/json',
          ...(current.exists ? { IfMatch: current.etag } : { IfNoneMatch: '*' }),
        });
        return next;
      } catch (error) {
        if (!isPreconditionFailed(error)) throw stageError(error, 'index_upload');
      }
    }
    throw storageError('r2_index_conflict', 'Cloudflare R2 index update conflicted repeatedly');
  }

  repKey(repId) {
    return `${this.prefix}/reps/${encodeURIComponent(repId)}/index.json`;
  }

  async indexEnvelope(metadata) {
    const operation = this.catalogQueue.then(() => this.indexEnvelopeUnlocked(metadata));
    this.catalogQueue = operation.catch(() => {});
    return operation;
  }

  async indexEnvelopeUnlocked(metadata) {
    const envelope = publicEnvelope(normalizeEnvelopeMetadata(metadata));
    const repIndex = await this.updateJsonIndex(
      this.repKey(envelope.rep.repId),
      { schemaVersion: CATALOG_SCHEMA_VERSION, repId: envelope.rep.repId, repEmail: envelope.rep.email, repName: envelope.rep.name, repType: envelope.rep.type, envelopes: [] },
      (index) => ({
        ...index,
        schemaVersion: CATALOG_SCHEMA_VERSION,
        repId: envelope.rep.repId,
        repEmail: envelope.rep.type === 'signer' ? envelope.rep.email : undefined,
        repName: envelope.rep.name,
        repType: envelope.rep.type,
        envelopes: upsertEnvelope(index.envelopes || [], envelope),
      }),
    );
    await this.updateJsonIndex(
      `${this.prefix}/envelopes/index.json`,
      { schemaVersion: CATALOG_SCHEMA_VERSION, envelopes: [] },
      (index) => ({ schemaVersion: CATALOG_SCHEMA_VERSION, envelopes: upsertEnvelope(index.envelopes || [], envelope) }),
    );
    const summary = repSummary(envelope.rep, repIndex.envelopes);
    await this.updateJsonIndex(
      `${this.prefix}/reps/index.json`,
      { schemaVersion: CATALOG_SCHEMA_VERSION, reps: [] },
      (index) => ({
        schemaVersion: CATALOG_SCHEMA_VERSION,
        reps: [...(index.reps || []).filter((rep) => rep.repId !== summary.repId), summary]
          .sort((a, b) => String(b.latestCompletedAt || '').localeCompare(String(a.latestCompletedAt || ''))),
      }),
    );
    return envelope;
  }

  async acquireLock(lock) {
    try {
      await this.put(lock, this.now().toISOString(), { ContentType: 'text/plain', IfNoneMatch: '*' });
      return true;
    } catch (error) {
      if (!isPreconditionFailed(error)) throw stageError(error, 'lock');
    }

    let existing;
    try {
      existing = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: lock }));
    } catch (error) {
      if (isNotFound(error)) return this.acquireLock(lock);
      throw stageError(error, 'lock');
    }
    const age = this.now().getTime() - new Date(existing.LastModified || 0).getTime();
    if (age <= LOCK_MAX_AGE_MS || !existing.ETag) return false;
    try {
      await this.put(lock, this.now().toISOString(), {
        ContentType: 'text/plain',
        IfMatch: existing.ETag,
      });
      return true;
    } catch (error) {
      if (isPreconditionFailed(error)) return false;
      throw stageError(error, 'lock');
    }
  }

  async claim(event) {
    const file = this.eventKey(event);
    const lock = `${file}.lock`;
    if (!(await this.acquireLock(lock))) return { claimed: false, file };
    const record = { ...event, receivedAt: this.now().toISOString(), status: 'processing' };
    try {
      let existing;
      try {
        existing = await this.getJson(file);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      // Holding the lock proves no other worker currently owns this event. A
      // leftover "processing" record is therefore an interrupted attempt and is
      // safe to retry, just like an explicitly failed record.
      if (existing && !['failed', 'processing'].includes(existing.status)) {
        await this.releaseClaim(lock);
        return { claimed: false, file, existing };
      }
      if (existing) record.retryCount = Number(existing.retryCount || 0) + 1;
      await this.put(file, `${JSON.stringify(record, null, 2)}\n`, { ContentType: 'application/json' });
      return { claimed: true, file, lock };
    } catch (error) {
      await this.releaseClaim(lock).catch(() => {});
      throw stageError(error, 'event_upload');
    }
  }

  async releaseClaim(lock) {
    if (!lock) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: lock }));
    } catch (error) {
      throw stageError(error, 'delete');
    }
  }

  async updateEvent(file, updates) {
    try {
      const existing = await this.getJson(file);
      await this.put(file, `${JSON.stringify({ ...existing, ...updates }, null, 2)}\n`, {
        ContentType: 'application/json',
      });
    } catch (error) {
      throw stageError(error, 'event_upload');
    }
  }

  async saveEnvelope(envelopeId, documents, envelopeMetadata) {
    const envelopePrefix = `${this.prefix}/envelopes/${safeSegment(envelopeId, 'envelope')}`;
    const saved = [];
    for (const document of documents) {
      const originalName = document.name || `document-${document.documentId}.pdf`;
      const filename = documentFilename(document);
      const objectKey = `${envelopePrefix}/documents/${filename}`;
      try {
        await this.put(objectKey, document.contents, {
          ContentType: filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        });
      } catch (error) {
        throw stageError(error, 'upload');
      }
      saved.push({
        documentId: document.documentId,
        name: originalName,
        storedName: filename,
        type: document.type || 'content',
        classification: metadataClassification(document.category),
        objectKey,
        bytes: document.contents.length,
      });
    }

    const metadataKey = `${envelopePrefix}/metadata.json`;
    const metadata = {
      provider: 'docusign',
      envelopeId,
      status: envelopeMetadata.status,
      sender: envelopeMetadata.sender,
      senderEmail: envelopeMetadata.senderEmail,
      eventTimestamp: envelopeMetadata.eventTimestamp,
      completedAt: envelopeMetadata.completedDateTime || envelopeMetadata.eventTimestamp,
      rep: envelopeMetadata.rep,
      repSource: envelopeMetadata.repSource,
      recipientResolution: envelopeMetadata.recipientResolution,
      retrievedAt: this.now().toISOString(),
      documents: saved,
    };
    try {
      await this.put(metadataKey, `${JSON.stringify(metadata, null, 2)}\n`, { ContentType: 'application/json' });
    } catch (error) {
      throw stageError(error, 'metadata_upload');
    }
    try {
      await this.indexEnvelope(metadata);
    } catch (error) {
      throw stageError(error, 'index_upload');
    }
    return saved;
  }

  async listEnvelopeMetadataRecords() {
    const records = [];
    let continuationToken;
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.prefix}/envelopes/`,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      }));
      for (const entry of result.CommonPrefixes || []) {
        if (!entry.Prefix || entry.Prefix === `${this.prefix}/envelopes/`) continue;
        try {
          records.push(await this.getJson(`${entry.Prefix}metadata.json`));
        } catch (error) {
          if (!isNotFound(error) && !(error instanceof SyntaxError) && !String(error.message).includes('Corrupted envelope metadata')) throw error;
        }
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return records;
  }

  async updateEnvelopeIdentity(envelopeId, identity) {
    const key = `${this.prefix}/envelopes/${safeSegment(envelopeId, 'envelope')}/metadata.json`;
    await this.updateJsonIndex(key, undefined, (existing) => {
      if (!existing) throw new Error('Envelope not found');
      return {
        ...existing,
        sender: identity.sender,
        senderEmail: identity.sender?.email,
        rep: identity.rep,
        repSource: 'completed_signer',
        recipientResolution: identity.recipientResolution,
      };
    });
  }

  async rebuildIndexes() {
    const operation = this.catalogQueue.then(async () => {
      const previous = await this.getJsonRecord(`${this.prefix}/reps/index.json`);
      const previousRepIds = new Set((previous.value?.reps || []).map((rep) => rep.repId));
      const envelopes = [];
      const groups = new Map();
      for (const metadata of await this.listEnvelopeMetadataRecords()) {
        let envelope;
        try {
          envelope = publicEnvelope(normalizeEnvelopeMetadata(metadata));
        } catch (error) {
          if (error.message === 'Corrupted envelope metadata') continue;
          throw error;
        }
        envelopes.push(envelope);
        const group = groups.get(envelope.rep.repId) || { rep: envelope.rep, envelopes: [] };
        group.rep = envelope.rep;
        group.envelopes = upsertEnvelope(group.envelopes, envelope);
        groups.set(envelope.rep.repId, group);
      }

      for (const [repId, group] of groups) {
        await this.updateJsonIndex(this.repKey(repId), {}, () => ({
          schemaVersion: CATALOG_SCHEMA_VERSION,
          repId,
          repEmail: group.rep.type === 'signer' ? group.rep.email : undefined,
          repName: group.rep.name,
          repType: group.rep.type,
          envelopes: group.envelopes,
        }));
        previousRepIds.delete(repId);
      }
      for (const staleRepId of previousRepIds) {
        await this.updateJsonIndex(this.repKey(staleRepId), {}, () => ({
          schemaVersion: CATALOG_SCHEMA_VERSION,
          repId: staleRepId,
          envelopes: [],
        }));
      }
      const sortedEnvelopes = [...envelopes]
        .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
      await this.updateJsonIndex(`${this.prefix}/envelopes/index.json`, {}, () => ({
        schemaVersion: CATALOG_SCHEMA_VERSION,
        envelopes: sortedEnvelopes,
      }));
      const reps = [...groups.values()]
        .map((group) => repSummary(group.rep, group.envelopes))
        .sort((a, b) => String(b.latestCompletedAt || '').localeCompare(String(a.latestCompletedAt || '')));
      await this.updateJsonIndex(`${this.prefix}/reps/index.json`, {}, () => ({
        schemaVersion: CATALOG_SCHEMA_VERSION,
        reps,
      }));
    });
    this.catalogQueue = operation.catch(() => {});
    return operation;
  }

  async ensureIndexes() {
    const global = await this.getJsonRecord(`${this.prefix}/envelopes/index.json`);
    if (global.exists && global.value?.schemaVersion === CATALOG_SCHEMA_VERSION) return;
    if (!this.rebuildPromise) this.rebuildPromise = this.rebuildIndexes().finally(() => { this.rebuildPromise = undefined; });
    await this.rebuildPromise;
  }

  async listReps() {
    await this.ensureIndexes();
    const record = await this.getJsonRecord(`${this.prefix}/reps/index.json`);
    const reps = [];
    for (const entry of record.value?.reps || []) {
      const repIndex = await this.getJsonRecord(this.repKey(entry.repId));
      if (!repIndex.value?.envelopes?.length) continue;
      reps.push(repSummary({
        repId: repIndex.value.repId,
        type: repIndex.value.repType,
        email: repIndex.value.repEmail,
        name: repIndex.value.repName,
      }, repIndex.value.envelopes));
    }
    return reps.sort((a, b) => String(b.latestCompletedAt || '').localeCompare(String(a.latestCompletedAt || '')));
  }

  async listRepEnvelopes(repId) {
    await this.ensureIndexes();
    const record = await this.getJsonRecord(this.repKey(repId));
    if (!record.exists || !record.value?.envelopes?.length) return undefined;
    return {
      rep: {
        repId: record.value.repId,
        type: record.value.repType,
        email: record.value.repEmail,
        name: record.value.repName,
      },
      envelopes: record.value.envelopes || [],
    };
  }

  async listEnvelopes() {
    await this.ensureIndexes();
    const record = await this.getJsonRecord(`${this.prefix}/envelopes/index.json`);
    return record.value?.envelopes || [];
  }

  async getEnvelopeRecord(envelopeId) {
    const key = `${this.prefix}/envelopes/${safeSegment(envelopeId, 'envelope')}/metadata.json`;
    try {
      return normalizeEnvelopeMetadata(await this.getJson(key));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof SyntaxError) throw new Error('Corrupted envelope metadata');
      throw error;
    }
  }

  async getEnvelope(envelopeId) {
    const envelope = await this.getEnvelopeRecord(envelopeId);
    return envelope ? publicEnvelope(envelope) : undefined;
  }

  async getDocument(envelopeId, documentId) {
    const envelope = await this.getEnvelopeRecord(envelopeId);
    if (!envelope) return undefined;
    const document = envelope.documents.find((item) => item.documentId === documentId);
    if (!document?.objectKey) return undefined;
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: document.objectKey,
    }));
    return {
      document,
      body: response.Body,
      contentLength: response.ContentLength || document.bytes,
      contentType: response.ContentType || 'application/pdf',
    };
  }

  async testConnectivity() {
    const key = `healthchecks/r2-test-${Date.now()}-${randomUUID()}.txt`;
    let uploaded = false;
    let read = false;
    try {
      try {
        await this.put(key, 'r2 connectivity check', { ContentType: 'text/plain', IfNoneMatch: '*' });
        uploaded = true;
      } catch (error) {
        throw stageError(error, 'upload');
      }
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        read = true;
      } catch (error) {
        throw stageError(error, 'read');
      }
    } finally {
      if (uploaded) {
        try {
          await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        } catch (error) {
          throw stageError(error, 'delete');
        }
      }
    }
    return { success: true, provider: 'r2', bucket: this.bucket, upload: uploaded, read, delete: true };
  }
}
