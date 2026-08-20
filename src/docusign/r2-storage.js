import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { documentFilename, metadataClassification, safeSegment } from './storage.js';

const LOCK_MAX_AGE_MS = 15 * 60 * 1000;

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
      senderEmail: envelopeMetadata.senderEmail,
      eventTimestamp: envelopeMetadata.eventTimestamp,
      retrievedAt: this.now().toISOString(),
      documents: saved,
    };
    try {
      await this.put(metadataKey, `${JSON.stringify(metadata, null, 2)}\n`, { ContentType: 'application/json' });
    } catch (error) {
      throw stageError(error, 'metadata_upload');
    }
    return saved;
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
