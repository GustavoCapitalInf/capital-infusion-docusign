import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeEnvelopeMetadata, publicEnvelope, repSummary } from './catalog.js';

export function safeSegment(value, fallback = 'document') {
  const normalized = String(value || fallback)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return normalized || fallback;
}

export function documentFilename(document) {
  const originalName = document.name || `document-${document.documentId}.pdf`;
  const rawExtension = path.extname(originalName);
  const extension = rawExtension ? `.${safeSegment(rawExtension.slice(1), 'pdf')}` : '.pdf';
  const base = safeSegment(path.basename(originalName, path.extname(originalName)));
  return `${safeSegment(document.documentId, 'unknown')}-${base}${extension}`;
}

export function metadataClassification(category) {
  return category === 'application' ? 'signed_document' : category;
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export class FileStorage {
  constructor(root) {
    this.root = root;
    this.provider = 'filesystem';
    this.contractQueues = new Map();
  }

  eventPath(event) {
    const digest = createHash('sha256').update(`${event.provider}:${event.envelopeId}:${event.event}`).digest('hex');
    return path.join(this.root, 'events', `${digest}.json`);
  }

  async claim(event) {
    const file = this.eventPath(event);
    const lock = `${file}.lock`;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    let lockHandle;
    try {
      lockHandle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = Date.now() - (await stat(lock)).mtimeMs;
      if (age <= 15 * 60 * 1000) return { claimed: false, file };
      await unlink(lock).catch((unlinkError) => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
      try {
        lockHandle = await open(lock, 'wx', 0o600);
      } catch (retryError) {
        if (retryError.code === 'EEXIST') return { claimed: false, file };
        throw retryError;
      }
    }
    await lockHandle.writeFile(new Date().toISOString());
    await lockHandle.close();

    const record = { ...event, receivedAt: new Date().toISOString(), status: 'processing' };
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
      await handle.close();
      return { claimed: true, file, lock };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await this.releaseClaim(lock);
        throw error;
      }
      const existing = JSON.parse(await readFile(file, 'utf8'));
      if (!['failed', 'processing'].includes(existing.status)) {
        await this.releaseClaim(lock);
        return { claimed: false, file, existing };
      }
      record.retryCount = Number(existing.retryCount || 0) + 1;
      await atomicJson(file, record);
      return { claimed: true, file, lock };
    }
  }

  async releaseClaim(lock) {
    if (!lock) return;
    await unlink(lock).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async updateEvent(file, updates) {
    const existing = JSON.parse(await readFile(file, 'utf8'));
    await atomicJson(file, { ...existing, ...updates });
  }

  async saveEnvelope(envelopeId, documents, envelopeMetadata) {
    const envelopeDirectory = path.join(this.root, 'envelopes', safeSegment(envelopeId, 'envelope'));
    const documentsDirectory = path.join(envelopeDirectory, 'documents');
    await mkdir(documentsDirectory, { recursive: true, mode: 0o700 });
    const saved = [];

    for (const document of documents) {
      const originalName = document.name || `document-${document.documentId}.pdf`;
      const filename = documentFilename(document);
      const target = path.join(documentsDirectory, filename);
      await writeFile(target, document.contents, { mode: 0o600 });
      saved.push({
        documentId: document.documentId,
        originalName,
        storedName: filename,
        type: document.type || 'content',
        category: document.category,
        classification: metadataClassification(document.category),
        bytes: document.contents.length,
      });
    }

    await atomicJson(path.join(envelopeDirectory, 'metadata.json'), {
      provider: 'docusign',
      envelopeId,
      status: envelopeMetadata.status,
      sender: envelopeMetadata.sender,
      senderEmail: envelopeMetadata.senderEmail,
      rep: envelopeMetadata.rep,
      repSource: envelopeMetadata.repSource,
      recipientResolution: envelopeMetadata.recipientResolution,
      completedAt: envelopeMetadata.completedDateTime || envelopeMetadata.eventTimestamp,
      eventTimestamp: envelopeMetadata.eventTimestamp,
      retrievedAt: new Date().toISOString(),
      envelope: envelopeMetadata,
      documents: saved,
    });
    return saved;
  }

  async getEnvelopeRecord(envelopeId) {
    const file = path.join(this.root, 'envelopes', safeSegment(envelopeId, 'envelope'), 'metadata.json');
    try {
      return normalizeEnvelopeMetadata(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) throw new Error('Corrupted envelope metadata');
      throw error;
    }
  }

  async listEnvelopeMetadataRecords() {
    const root = path.join(this.root, 'envelopes');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        records.push(JSON.parse(await readFile(path.join(root, entry.name, 'metadata.json'), 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
    }
    return records;
  }

  async updateEnvelopeIdentity(envelopeId, identity) {
    const file = path.join(this.root, 'envelopes', safeSegment(envelopeId, 'envelope'), 'metadata.json');
    const existing = JSON.parse(await readFile(file, 'utf8'));
    await atomicJson(file, {
      ...existing,
      sender: identity.sender,
      senderEmail: identity.sender?.email,
      rep: identity.rep,
      repSource: 'completed_signer',
      recipientResolution: identity.recipientResolution,
    });
  }

  async rebuildIndexes() {
    // Filesystem catalog views are derived from metadata.json on each request.
  }

  contractLifecyclePath(repId) {
    return path.join(this.root, 'contracts', 'reps', encodeURIComponent(repId), 'lifecycle.json');
  }

  async getRepContractLifecycle(repId) {
    try {
      return JSON.parse(await readFile(this.contractLifecyclePath(repId), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) throw new Error('Corrupted contract lifecycle');
      throw error;
    }
  }

  async writeRepContractLifecycle(repId, lifecycle) {
    const file = this.contractLifecyclePath(repId);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await atomicJson(file, lifecycle);
    return lifecycle;
  }

  async queueContractOperation(repId, action) {
    const previous = this.contractQueues.get(repId) || Promise.resolve();
    const operation = previous.then(action);
    const queued = operation.catch(() => {});
    this.contractQueues.set(repId, queued);
    return operation.finally(() => {
      if (this.contractQueues.get(repId) === queued) this.contractQueues.delete(repId);
    });
  }

  async saveRepContractLifecycle(repId, lifecycle) {
    return this.queueContractOperation(repId, () => this.writeRepContractLifecycle(repId, lifecycle));
  }

  async updateRepContractLifecycle(repId, mutate) {
    return this.queueContractOperation(repId, async () => {
      const current = await this.getRepContractLifecycle(repId);
      const next = mutate(current);
      if (!next || next === current) return current;
      return this.writeRepContractLifecycle(repId, next);
    });
  }

  async listContractLifecycles() {
    const root = path.join(this.root, 'contracts', 'reps');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const lifecycles = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        lifecycles.push(JSON.parse(await readFile(path.join(root, entry.name, 'lifecycle.json'), 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
    }
    return lifecycles;
  }

  notificationPath(notificationId) {
    return path.join(this.root, 'contracts', 'notifications', `${encodeURIComponent(notificationId)}.json`);
  }

  async claimContractNotification(notification) {
    const file = this.notificationPath(notification.notificationId);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ ...notification, status: 'processing' }, null, 2)}\n`);
      await handle.close();
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  }

  async saveContractNotification(notification) {
    await atomicJson(this.notificationPath(notification.notificationId), notification);
  }

  async releaseContractNotification(notificationId) {
    await unlink(this.notificationPath(notificationId)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async getEnvelope(envelopeId) {
    const envelope = await this.getEnvelopeRecord(envelopeId);
    return envelope ? publicEnvelope(envelope) : undefined;
  }

  async listEnvelopes() {
    const root = path.join(this.root, 'envelopes');
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const envelopes = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const envelope = await this.getEnvelope(entry.name);
        if (envelope) envelopes.push(envelope);
      } catch (error) {
        if (error.message !== 'Corrupted envelope metadata') throw error;
      }
    }
    return envelopes.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  }

  async listReps() {
    const envelopes = await this.listEnvelopes();
    const grouped = new Map();
    for (const envelope of envelopes) {
      const group = grouped.get(envelope.rep.repId) || { rep: envelope.rep, envelopes: [] };
      group.envelopes.push(envelope);
      grouped.set(envelope.rep.repId, group);
    }
    return [...grouped.values()]
      .map(({ rep, envelopes: items }) => repSummary(rep, items))
      .sort((a, b) => String(b.latestCompletedAt || '').localeCompare(String(a.latestCompletedAt || '')));
  }

  async listRepEnvelopes(repId) {
    const envelopes = (await this.listEnvelopes()).filter((envelope) => envelope.rep.repId === repId);
    if (!envelopes.length) return undefined;
    return { rep: envelopes[0].rep, envelopes };
  }

  async getDocument(envelopeId, documentId) {
    const envelope = await this.getEnvelopeRecord(envelopeId);
    if (!envelope) return undefined;
    const document = envelope.documents.find((item) => item.documentId === documentId);
    if (!document?.storedName) return undefined;
    const target = path.join(
      this.root,
      'envelopes',
      safeSegment(envelopeId, 'envelope'),
      'documents',
      document.storedName,
    );
    try {
      const information = await stat(target);
      return {
        document,
        body: createReadStream(target),
        contentLength: information.size,
        contentType: target.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      };
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

export function classifyDocument(document) {
  const value = `${document.type || ''} ${document.name || ''} ${document.documentId || ''}`.toLowerCase();
  if (document.type === 'summary' || value.includes('certificate')) return 'certificate';
  if (document.type && document.type !== 'content') return 'supplemental';
  return 'application';
}
