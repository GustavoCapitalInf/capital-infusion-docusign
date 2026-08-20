import { classifyDocument } from './storage.js';

function senderEmail(envelope) {
  return envelope?.sender?.email || envelope?.sender?.emailAddress || envelope?.senderEmail;
}

export class CompletedEnvelopeProcessor {
  constructor({ client, storage, allowedSenders, logger }) {
    this.client = client;
    this.storage = storage;
    this.allowedSenders = allowedSenders;
    this.logger = logger;
  }

  async process(event, claim) {
    const eventFile = claim.file;
    try {
      const envelope = await this.client.getEnvelope(event.envelopeId);
      const sender = (senderEmail(envelope) || event.senderEmail || '').toLowerCase();
      if (this.allowedSenders.size && !this.allowedSenders.has(sender)) {
        await this.storage.updateEvent(eventFile, {
          status: 'ignored',
          processedAt: new Date().toISOString(),
          reason: sender ? 'sender-not-allowed' : 'sender-unavailable',
        });
        this.logger.info('DocuSign envelope ignored by sender filter', { envelopeId: event.envelopeId, senderEmail: sender || undefined });
        return;
      }

      const listed = await this.client.listDocuments(event.envelopeId);
      const documents = [];
      for (const document of listed) {
        try {
          documents.push({
            ...document,
            category: classifyDocument(document),
            contents: await this.client.downloadDocument(event.envelopeId, document.documentId),
          });
        } catch (error) {
          this.logger.error('DocuSign document download failure', {
            envelopeId: event.envelopeId,
            documentId: document.documentId,
            error: error.message,
          });
          throw error;
        }
      }
      const saved = await this.storage.saveEnvelope(event.envelopeId, documents, {
        status: envelope.status,
        senderEmail: sender || undefined,
        completedDateTime: envelope.completedDateTime,
        eventTimestamp: event.timestamp,
      });
      await this.storage.updateEvent(eventFile, {
        status: 'processed',
        processedAt: new Date().toISOString(),
        senderEmail: sender || undefined,
        documentCount: saved.length,
      });
      this.logger.info('DocuSign documents retrieved', { envelopeId: event.envelopeId, documentCount: saved.length });
    } catch (error) {
      await this.storage.updateEvent(eventFile, {
        status: 'failed',
        processedAt: new Date().toISOString(),
        error: error.message,
      });
      const message = {
        authentication: 'DocuSign authentication failure',
        'document-list': 'DocuSign document-list failure',
        'document-download': 'DocuSign document-download failure',
      }[error.stage] || 'DocuSign envelope processing failed';
      this.logger.error(message, { envelopeId: event.envelopeId, error: error.message });
    } finally {
      await this.storage.releaseClaim(claim.lock);
    }
  }
}
