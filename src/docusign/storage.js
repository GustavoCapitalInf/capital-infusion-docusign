import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function safeSegment(value, fallback = 'document') {
  const normalized = String(value || fallback)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return normalized || fallback;
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export class FileStorage {
  constructor(root) {
    this.root = root;
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
      if (existing.status !== 'failed') {
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
      const rawExtension = path.extname(originalName);
      const extension = rawExtension ? `.${safeSegment(rawExtension.slice(1), 'pdf')}` : '.pdf';
      const base = safeSegment(path.basename(originalName, path.extname(originalName)));
      const filename = `${safeSegment(document.documentId, 'unknown')}-${base}${extension}`;
      const target = path.join(documentsDirectory, filename);
      await writeFile(target, document.contents, { mode: 0o600 });
      saved.push({
        documentId: document.documentId,
        originalName,
        storedName: filename,
        type: document.type || 'content',
        category: document.category,
        bytes: document.contents.length,
      });
    }

    await atomicJson(path.join(envelopeDirectory, 'metadata.json'), {
      provider: 'docusign',
      envelopeId,
      retrievedAt: new Date().toISOString(),
      envelope: envelopeMetadata,
      documents: saved,
    });
    return saved;
  }
}

export function classifyDocument(document) {
  const value = `${document.type || ''} ${document.name || ''} ${document.documentId || ''}`.toLowerCase();
  if (document.type === 'summary' || value.includes('certificate')) return 'certificate';
  if (document.type && document.type !== 'content') return 'supplemental';
  return 'application';
}
