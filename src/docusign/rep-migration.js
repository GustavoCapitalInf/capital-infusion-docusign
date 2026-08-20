import { normalizeEmail, resolveRepFromRecipients } from './rep.js';

function senderFromMetadata(metadata) {
  const envelope = metadata.envelope || {};
  const nestedSender = envelope.sender || {};
  return {
    email: normalizeEmail(
      metadata.sender?.email || metadata.senderEmail || nestedSender.email ||
      nestedSender.emailAddress || envelope.senderEmail,
    ) || undefined,
    name: metadata.sender?.name || nestedSender.userName || nestedSender.name || envelope.senderName,
  };
}

export async function migrateSignerRepMetadata({ client, storage, logger }) {
  if (!storage.listEnvelopeMetadataRecords || !storage.updateEnvelopeIdentity || !storage.rebuildIndexes) {
    return { scanned: 0, migrated: 0, failed: 0 };
  }

  const records = await storage.listEnvelopeMetadataRecords();
  let migrated = 0;
  let failed = 0;
  for (const metadata of records) {
    if (metadata.repSource === 'completed_signer') continue;
    try {
      const recipients = await client.listRecipients(metadata.envelopeId);
      const { rep, resolution } = resolveRepFromRecipients(recipients);
      await storage.updateEnvelopeIdentity(metadata.envelopeId, {
        sender: senderFromMetadata(metadata),
        rep,
        recipientResolution: resolution,
      });
      migrated += 1;
    } catch (error) {
      failed += 1;
      logger.warn('Historical DocuSign signer migration failed', {
        envelopeId: metadata.envelopeId,
        stage: error.stage || 'recipient-migration',
      });
    }
  }

  await storage.rebuildIndexes();
  return { scanned: records.length, migrated, failed };
}
