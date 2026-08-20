import { classifyDocument } from './storage.js';
import { resolveRepFromSender } from './rep.js';

function senderEmail(envelope) {
  return envelope?.sender?.email || envelope?.sender?.emailAddress || envelope?.senderEmail;
}

function envelopeSender(envelope, webhookEmail) {
  return {
    email: senderEmail(envelope) || webhookEmail,
    name: envelope?.sender?.userName || envelope?.sender?.name || envelope?.senderName,
  };
}

export class CompletedEnvelopeProcessor {
  constructor({ client, storage, allowedSenders, repEmailDomain, logger }) {
    this.client = client;
    this.storage = storage;
    this.allowedSenders = allowedSenders;
    this.repEmailDomain = repEmailDomain;
    this.logger = logger;
  }

  async process(event, claim) {
    const eventFile = claim.file;
    try {
      const envelope = await this.client.getEnvelope(event.envelopeId);
      const senderDetails = envelopeSender(envelope, event.senderEmail);
      const sender = (senderDetails.email || '').toLowerCase();
      const rep = resolveRepFromSender(senderDetails, this.repEmailDomain);
      if (this.allowedSenders.size && !this.allowedSenders.has(sender)) {
        this.logger.warn('DocuSign sender is outside the configured sender allowlist; storing as rep-resolved envelope', {
          envelopeId: event.envelopeId,
          senderEmail: sender || undefined,
          repType: rep.type,
        });
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
        rep,
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
