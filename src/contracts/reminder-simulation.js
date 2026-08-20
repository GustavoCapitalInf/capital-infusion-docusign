import { randomUUID } from 'node:crypto';
import {
  REMINDER_THRESHOLDS,
  publicContractLifecycle,
  reminderThresholdForDays,
} from './lifecycle.js';

function simulationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function evaluationDate(expiresAt, daysRemaining) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    throw simulationError('Active contract has an invalid expiration date', 'invalid_contract_expiration');
  }
  date.setUTCDate(date.getUTCDate() - daysRemaining);
  return date;
}

export function assertSimulationThreshold(daysRemaining) {
  if (!REMINDER_THRESHOLDS.includes(daysRemaining)) {
    throw simulationError(
      `Unsupported test threshold: ${daysRemaining}. Use 30, 15, 7, or 0.`,
      'unsupported_contract_reminder_threshold',
    );
  }
}

export class ContractReminderSimulation {
  constructor({ storage, emailProvider, recipient, now = () => new Date(), uniqueRunId = randomUUID }) {
    this.storage = storage;
    this.emailProvider = emailProvider;
    this.recipient = recipient;
    this.now = now;
    this.uniqueRunId = uniqueRunId;
  }

  async loadSimulation(repId, daysRemaining) {
    assertSimulationThreshold(daysRemaining);
    this.emailProvider.assertConfigured(this.recipient);
    const lifecycle = await this.storage.getRepContractLifecycle(repId);
    if (!lifecycle) {
      throw simulationError('Contract lifecycle not found', 'contract_lifecycle_not_found');
    }
    const snapshot = JSON.stringify(lifecycle);
    const simulatedNow = evaluationDate(lifecycle.currentContract?.expiresAt, daysRemaining);
    const contract = publicContractLifecycle(lifecycle, simulatedNow);
    if (!contract?.currentContract) {
      throw simulationError('Active contract not found', 'active_contract_not_found');
    }
    if (![1, 2].includes(contract.currentTier)) {
      throw simulationError('Active contract tier does not send renewal reminders', 'contract_tier_not_eligible');
    }
    const threshold = reminderThresholdForDays(contract.daysRemaining);
    if (contract.daysRemaining !== daysRemaining || threshold !== daysRemaining) {
      throw simulationError('Unable to simulate the requested threshold', 'contract_reminder_simulation_mismatch');
    }
    return { lifecycle, snapshot, contract };
  }

  async attempt({ contract, daysRemaining, runId }) {
    const notificationId = `test:${contract.currentContract.envelopeId}:${daysRemaining}:${runId}`;
    const notification = {
      notificationId,
      namespace: 'test',
      contractEnvelopeId: contract.currentContract.envelopeId,
      repId: contract.repId,
      thresholdDays: daysRemaining,
      recipient: this.recipient,
      claimedAt: this.now().toISOString(),
    };
    if (!(await this.storage.claimContractNotification(notification))) return 'skipped_duplicate';

    let delivered = false;
    try {
      const delivery = await this.emailProvider.sendContractReminder({
        notificationId,
        to: this.recipient,
        rep: { repId: contract.repId, email: contract.repEmail, name: contract.repName },
        currentTier: contract.currentTier,
        nextTier: contract.nextTier,
        expiresAt: contract.expiresAt,
        daysRemaining,
        isTest: true,
      });
      delivered = true;
      await this.storage.saveContractNotification({
        ...notification,
        status: 'sent',
        sentAt: this.now().toISOString(),
        providerMessageId: delivery?.messageId,
      });
      return 'sent';
    } catch (cause) {
      if (!delivered) await this.storage.releaseContractNotification(notificationId).catch(() => {});
      const error = simulationError('Contract reminder test delivery failed', 'contract_reminder_test_delivery_failed');
      error.cause = cause;
      throw error;
    }
  }

  async run({ repId, daysRemaining, idempotencyTest = false }) {
    const normalizedRepId = String(repId || '').trim().toLowerCase();
    if (!normalizedRepId) {
      throw simulationError('Missing required --rep argument', 'missing_contract_reminder_test_rep');
    }
    const { snapshot, contract } = await this.loadSimulation(normalizedRepId, daysRemaining);
    const runId = this.uniqueRunId();
    const firstAttempt = await this.attempt({ contract, daysRemaining, runId });
    const secondAttempt = idempotencyTest
      ? await this.attempt({ contract, daysRemaining, runId })
      : undefined;
    const after = await this.storage.getRepContractLifecycle(normalizedRepId);
    const productionLifecycleModified = JSON.stringify(after) !== snapshot;
    if (productionLifecycleModified) {
      throw simulationError(
        'Production lifecycle changed during the reminder test',
        'production_lifecycle_changed_during_test',
      );
    }

    return {
      success: firstAttempt === 'sent',
      repId: normalizedRepId,
      threshold: daysRemaining,
      emailSent: firstAttempt === 'sent',
      productionLifecycleModified,
      ...(idempotencyTest ? { firstAttempt, secondAttempt } : {}),
    };
  }
}
