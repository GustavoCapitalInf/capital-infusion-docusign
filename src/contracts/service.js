import { normalizeEnvelopeMetadata } from '../docusign/catalog.js';
import {
  applyCompletedEnvelopeToLifecycle,
  buildContractLifecycle,
  publicContractLifecycle,
  reminderThresholdForDays,
  trackedContractDocuments,
} from './lifecycle.js';

export class ContractLifecycleService {
  constructor({ storage, logger, now = () => new Date() }) {
    this.storage = storage;
    this.logger = logger;
    this.now = now;
  }

  async recordCompletedEnvelope(envelope) {
    if (envelope.rep?.type !== 'signer' || !trackedContractDocuments(envelope.documents).length) {
      return undefined;
    }
    return this.storage.updateRepContractLifecycle(envelope.rep.repId, (current) => {
      const result = applyCompletedEnvelopeToLifecycle(current, envelope, this.now().toISOString());
      return result.changed ? result.lifecycle : current;
    });
  }

  async backfillFromEnvelopeMetadata() {
    const groups = new Map();
    let scannedEnvelopes = 0;
    let trackedEnvelopes = 0;
    for (const metadata of await this.storage.listEnvelopeMetadataRecords()) {
      let envelope;
      try {
        envelope = normalizeEnvelopeMetadata(metadata);
      } catch (error) {
        if (error.message === 'Corrupted envelope metadata') continue;
        throw error;
      }
      scannedEnvelopes += 1;
      if (envelope.rep.type !== 'signer' || !trackedContractDocuments(envelope.documents).length) continue;
      trackedEnvelopes += 1;
      const group = groups.get(envelope.rep.repId) || { rep: envelope.rep, envelopes: [] };
      group.rep = envelope.rep;
      group.envelopes.push(envelope);
      groups.set(envelope.rep.repId, group);
    }

    for (const [repId, group] of groups) {
      await this.storage.updateRepContractLifecycle(repId, (current) => {
        const envelopes = [...group.envelopes];
        const envelopeIds = new Set(envelopes.map((envelope) => envelope.envelopeId));
        for (const contract of current?.contracts || []) {
          if (envelopeIds.has(contract.envelopeId)) continue;
          envelopes.push({
            envelopeId: contract.envelopeId,
            completedAt: contract.signedAt,
            documents: [{
              documentId: contract.documentId,
              name: contract.documentName,
            }],
          });
        }
        const lifecycle = buildContractLifecycle(group.rep, envelopes, this.now().toISOString());
        const knownResolutions = new Set((lifecycle.contractResolutions || []).map((item) => item.envelopeId));
        const preservedResolutions = (current?.contractResolutions || [])
          .filter((item) => !knownResolutions.has(item.envelopeId));
        return {
          ...lifecycle,
          contractResolutions: [...(lifecycle.contractResolutions || []), ...preservedResolutions],
          requiresContractResolution: Boolean(lifecycle.requiresContractResolution || preservedResolutions.length),
        };
      });
    }
    return { scannedEnvelopes, trackedEnvelopes, lifecycleCount: groups.size };
  }

  async getRepContract(repId) {
    return publicContractLifecycle(await this.storage.getRepContractLifecycle(repId), this.now());
  }

  async enrichReps(reps) {
    return Promise.all(reps.map(async (rep) => ({
      ...rep,
      contract: await this.getRepContract(rep.repId),
    })));
  }

  async listRenewals(maxDays = 30) {
    const renewals = [];
    for (const lifecycle of await this.storage.listContractLifecycles()) {
      const value = publicContractLifecycle(lifecycle, this.now());
      if (!value?.currentContract || ![1, 2].includes(value.currentTier) || value.daysRemaining > maxDays) continue;
      renewals.push({
        repId: value.repId,
        repName: value.repName,
        repEmail: value.repEmail,
        currentTier: value.currentTier,
        nextTier: value.nextTier,
        expiresAt: value.expiresAt,
        daysRemaining: value.daysRemaining,
      });
    }
    return renewals.sort((a, b) => a.daysRemaining - b.daysRemaining || String(a.repName).localeCompare(String(b.repName)));
  }

  async sendEligibleReminders({ emailProvider, recipient }) {
    emailProvider.assertConfigured(recipient);
    const lifecycles = await this.storage.listContractLifecycles();
    const result = { activeContractsChecked: 0, eligibleReminders: 0, sent: 0, skipped: 0, failed: 0 };
    for (const lifecycle of lifecycles) {
      const contract = publicContractLifecycle(lifecycle, this.now());
      if (!contract?.currentContract || ![1, 2].includes(contract.currentTier)) continue;
      result.activeContractsChecked += 1;
      const thresholdDays = reminderThresholdForDays(contract.daysRemaining);
      if (thresholdDays === undefined) continue;
      result.eligibleReminders += 1;
      const notificationId = `${contract.currentContract.envelopeId}:${thresholdDays}`;
      const notification = {
        notificationId,
        contractEnvelopeId: contract.currentContract.envelopeId,
        repId: contract.repId,
        thresholdDays,
        recipient,
        claimedAt: this.now().toISOString(),
      };
      if (!(await this.storage.claimContractNotification(notification))) {
        result.skipped += 1;
        continue;
      }
      let delivered = false;
      try {
        const delivery = await emailProvider.sendContractReminder({
          notificationId,
          to: recipient,
          rep: { repId: contract.repId, email: contract.repEmail, name: contract.repName },
          currentTier: contract.currentTier,
          nextTier: contract.nextTier,
          expiresAt: contract.expiresAt,
          daysRemaining: thresholdDays,
        });
        delivered = true;
        await this.storage.saveContractNotification({
          ...notification,
          status: 'sent',
          sentAt: this.now().toISOString(),
          providerMessageId: delivery?.messageId,
        });
        result.sent += 1;
        this.logger.info('Contract reminder sent', { repId: contract.repId, thresholdDays });
      } catch (error) {
        // Once the provider acknowledges delivery, retain the processing claim
        // even if final persistence fails. At-most-once delivery is safer than
        // deleting the claim and risking a duplicate email on the next run.
        if (!delivered) await this.storage.releaseContractNotification(notificationId).catch(() => {});
        result.failed += 1;
        this.logger.warn('Contract reminder delivery failed', {
          repId: contract.repId,
          thresholdDays,
          error: error.code || 'email_delivery_failed',
        });
      }
    }
    return result;
  }
}
