import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractLifecycle } from '../src/contracts/lifecycle.js';
import { PowerAutomateContractEmailProvider } from '../src/contracts/email.js';
import { ContractReminderSimulation } from '../src/contracts/reminder-simulation.js';

const rep = {
  repId: 'sarahfondeur5@gmail.com',
  type: 'signer',
  email: 'sarahfondeur5@gmail.com',
  name: 'Sarah Fondeur',
};

function lifecycle() {
  return buildContractLifecycle(rep, [{
    envelopeId: 'envelope-A',
    completedAt: '2026-08-19T15:30:00.000Z',
    documents: [{ documentId: '1', name: 'Capital Infusion - Sarah Fondeur.pdf' }],
  }]);
}

function harness({ provider } = {}) {
  const original = lifecycle();
  const claims = new Set();
  const claimedRecords = [];
  const savedRecords = [];
  const deliveries = [];
  const storage = {
    getRepContractLifecycle: async () => structuredClone(original),
    claimContractNotification: async (notification) => {
      claimedRecords.push(notification);
      if (claims.has(notification.notificationId)) return false;
      claims.add(notification.notificationId);
      return true;
    },
    saveContractNotification: async (notification) => savedRecords.push(notification),
    releaseContractNotification: async (notificationId) => claims.delete(notificationId),
  };
  const emailProvider = provider || {
    name: 'power-automate',
    assertConfigured() {},
    sendContractReminder: async (message) => {
      deliveries.push(message);
      return { messageId: 'provider-message-id', status: 200 };
    },
  };
  const simulation = new ContractReminderSimulation({
    storage,
    emailProvider,
    recipient: 'gustavo@capital-infusion.com',
    now: () => new Date('2026-08-20T12:00:00.000Z'),
    uniqueRunId: () => 'unique-run-id',
  });
  return { original, claims, claimedRecords, savedRecords, deliveries, simulation };
}

for (const daysRemaining of [30, 15, 7, 0]) {
  test(`simulates the ${daysRemaining}-day reminder from the real active contract`, async () => {
    const state = harness();
    const before = JSON.stringify(state.original);
    const result = await state.simulation.run({
      repId: 'SarahFondeur5@gmail.com',
      daysRemaining,
    });

    assert.deepEqual(result, {
      success: true,
      repId: 'sarahfondeur5@gmail.com',
      threshold: daysRemaining,
      emailSent: true,
      productionLifecycleModified: false,
    });
    assert.equal(state.deliveries.length, 1);
    assert.equal(state.deliveries[0].daysRemaining, daysRemaining);
    assert.equal(state.deliveries[0].expiresAt, state.original.currentContract.expiresAt);
    assert.equal(state.deliveries[0].isTest, true);
    assert.equal(JSON.stringify(state.original), before);
    assert.equal(state.original.contracts.length, 1);
  });
}

test('rejects unsupported reminder thresholds before claiming or sending', async () => {
  const state = harness();
  await assert.rejects(
    state.simulation.run({ repId: rep.repId, daysRemaining: 14 }),
    { code: 'unsupported_contract_reminder_threshold' },
  );
  assert.equal(state.claimedRecords.length, 0);
  assert.equal(state.deliveries.length, 0);
});

test('uses test notification IDs isolated from production reminder IDs', async () => {
  const state = harness();
  await state.simulation.run({ repId: rep.repId, daysRemaining: 30 });
  assert.equal(state.claimedRecords[0].notificationId, 'test:envelope-A:30:unique-run-id');
  assert.notEqual(state.claimedRecords[0].notificationId, 'envelope-A:30');
  assert.equal(state.claimedRecords[0].namespace, 'test');
  assert.equal(state.savedRecords[0].status, 'sent');
});

test('idempotency mode sends once and skips the duplicate through persistent claims', async () => {
  const state = harness();
  const result = await state.simulation.run({
    repId: rep.repId,
    daysRemaining: 15,
    idempotencyTest: true,
  });
  assert.equal(result.firstAttempt, 'sent');
  assert.equal(result.secondAttempt, 'skipped_duplicate');
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.claimedRecords.length, 2);
  assert.equal(state.claimedRecords[0].notificationId, state.claimedRecords[1].notificationId);
  assert.equal(state.savedRecords.length, 1);
});

test('failed simulated delivery releases only its test claim for retry', async () => {
  const provider = {
    assertConfigured() {},
    sendContractReminder: async () => {
      const error = new Error('provider unavailable');
      error.code = 'contract_email_delivery_failed';
      throw error;
    },
  };
  const state = harness({ provider });
  await assert.rejects(
    state.simulation.run({ repId: rep.repId, daysRemaining: 7 }),
    { code: 'contract_reminder_test_delivery_failed' },
  );
  assert.equal(state.claims.size, 0);
  assert.equal(state.savedRecords.length, 0);
  assert.equal(state.claimedRecords[0].notificationId.startsWith('test:'), true);
});

test('reuses the Power Automate provider with explicit simulated email content', async () => {
  let payload;
  const provider = new PowerAutomateContractEmailProvider({
    url: 'https://example.invalid/flow',
    fetch: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => '{"success":true}' };
    },
  });
  const state = harness({ provider });
  await state.simulation.run({ repId: rep.repId, daysRemaining: 0 });

  assert.equal(payload.isTest, true);
  assert.equal(payload.subject, '[TEST] Sarah Fondeur contract expires today');
  assert.equal(payload.body.startsWith('This is a contract reminder test.'), true);
  assert.equal(payload.body.includes('This test did not modify the real contract expiration date.'), true);
  assert.equal(payload.notificationId.startsWith('test:'), true);
});
