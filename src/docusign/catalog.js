import { normalizeEmail } from './rep.js';

function classification(category) {
  return category === 'application' ? 'signed_document' : category;
}

export function normalizeEnvelopeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || !metadata.envelopeId) {
    throw new Error('Corrupted envelope metadata');
  }
  const senderEmail = normalizeEmail(metadata.sender?.email || metadata.senderEmail || metadata.envelope?.senderEmail);
  const signerResolved = metadata.repSource === 'completed_signer';
  const rep = signerResolved && metadata.rep?.repId
    ? metadata.rep
    : { repId: 'requires-resolution', type: 'requires_resolution', name: 'Rep Resolution Required' };
  const documents = Array.isArray(metadata.documents)
    ? metadata.documents.map((document) => ({
      documentId: String(document.documentId),
      name: document.name || document.originalName || document.storedName || `Document ${document.documentId}`,
      classification: document.classification || classification(document.category),
      objectKey: document.objectKey,
      storedName: document.storedName,
      bytes: document.bytes,
      type: document.type,
    }))
    : [];
  const completedAt = metadata.completedAt || metadata.completedDateTime || metadata.eventTimestamp ||
    metadata.envelope?.completedDateTime || metadata.retrievedAt;
  const primary = documents.find((document) => document.classification === 'signed_document') || documents[0];
  return {
    envelopeId: String(metadata.envelopeId),
    status: metadata.status || metadata.envelope?.status || 'completed',
    sender: {
      email: senderEmail || undefined,
      name: metadata.sender?.name || metadata.envelope?.senderName,
    },
    senderEmail: senderEmail || undefined,
    rep: {
      repId: rep.repId,
      type: rep.type || (rep.repId === 'unassigned' ? 'unassigned' : 'signer'),
      email: rep.email,
      name: rep.name || 'Unknown Rep',
    },
    repSource: signerResolved ? 'completed_signer' : 'legacy_sender',
    recipientResolution: metadata.recipientResolution || {
      status: 'requires_resolution',
      completedSignerCount: undefined,
    },
    needsRecipientMigration: !signerResolved,
    completedAt,
    primaryDocumentName: primary?.name,
    documentCount: documents.length,
    documents,
  };
}

export function publicEnvelope(envelope) {
  return {
    envelopeId: envelope.envelopeId,
    status: envelope.status,
    sender: envelope.sender,
    senderEmail: envelope.senderEmail,
    rep: envelope.rep,
    completedAt: envelope.completedAt,
    primaryDocumentName: envelope.primaryDocumentName,
    documentCount: envelope.documentCount,
    documents: envelope.documents.map((document) => ({
      documentId: document.documentId,
      name: document.name,
      classification: document.classification,
    })),
    recipientResolution: envelope.recipientResolution,
  };
}

export function repSummary(rep, envelopes) {
  const sorted = [...envelopes].sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  return {
    repId: rep.repId,
    type: rep.type,
    name: rep.name,
    email: rep.type === 'signer' ? rep.email : undefined,
    completedEnvelopeCount: sorted.length,
    latestCompletedAt: sorted[0]?.completedAt,
  };
}

export function upsertEnvelope(envelopes, envelope) {
  const next = envelopes.filter((item) => item.envelopeId !== envelope.envelopeId);
  next.push(envelope);
  return next.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
}
