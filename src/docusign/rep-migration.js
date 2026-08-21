import { normalizeEmail, REP_RESOLVER_VERSION, resolveRepFromRecipients } from './rep.js';

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

function requiresResolution(metadata) {
  return metadata.rep?.repId === 'requires-resolution'
    || metadata.rep?.type === 'requires_resolution'
    || metadata.recipientResolution?.status === 'requires_resolution';
}

export async function migrateSignerRepMetadata({ client, storage, internalSigners, logger }) {
  if (!storage.listEnvelopeMetadataRecords || !storage.updateEnvelopeIdentity || !storage.rebuildIndexes) {
    return { scanned: 0, migrated: 0, failed: 0, demoSkipped: 0, unresolvedBefore: 0, unresolvedAfter: 0 };
  }

  const records = await storage.listEnvelopeMetadataRecords();
  let migrated = 0;
  let failed = 0;
  let demoSkipped = 0;
  let unresolvedBefore = 0;
  let unresolvedAfter = 0;
  for (const metadata of records) {
    if (storage.isEnvelopeExcluded?.(metadata)) {
      demoSkipped += 1;
      continue;
    }
    const wasUnresolved = requiresResolution(metadata);
    if (wasUnresolved) unresolvedBefore += 1;
    if (metadata.recipientResolution?.resolverVersion === REP_RESOLVER_VERSION) {
      if (wasUnresolved) unresolvedAfter += 1;
      continue;
    }
    try {
      const recipients = await client.listRecipients(metadata.envelopeId);
      const { rep, resolution } = resolveRepFromRecipients(recipients, { internalSigners });
      await storage.updateEnvelopeIdentity(metadata.envelopeId, {
        sender: senderFromMetadata(metadata),
        rep,
        recipientResolution: resolution,
      });
      if (resolution.status === 'requires_resolution') unresolvedAfter += 1;
      migrated += 1;
    } catch (error) {
      failed += 1;
      if (wasUnresolved) unresolvedAfter += 1;
      logger.warn('Historical DocuSign signer migration failed', {
        envelopeId: metadata.envelopeId,
        stage: error.stage || 'recipient-migration',
      });
    }
  }

  await storage.rebuildIndexes();
  return { scanned: records.length, migrated, failed, demoSkipped, unresolvedBefore, unresolvedAfter };
}
