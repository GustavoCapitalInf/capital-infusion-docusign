import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarMonths,
  applyCompletedEnvelopeToLifecycle,
  buildContractLifecycle,
  classifyContractType,
  isTrackedEmploymentContract,
  reminderThresholdForDays,
} from '../src/contracts/lifecycle.js';
import { ContractLifecycleService } from '../src/contracts/service.js';
import { ResendContractEmailProvider } from '../src/contracts/email.js';

const rep = { repId: 'rep@example.com', type: 'signer', email: 'rep@example.com', name: 'Example Rep' };

function envelope(envelopeId, completedAt, names = ['Employment_Offer_and_Agreement.pdf']) {
  return {
    envelopeId,
    completedAt,
    rep,
    documents: names.map((name, index) => ({ documentId: String(index + 1), name })),
  };
}

test('classifies only W-2 and 1099 PDF filename prefixes', () => {
  assert.equal(classifyContractType('Employment_Offer_and_Agreement.pdf'), 'W-2');
  assert.equal(classifyContractType('Employment_Offer_and_Agreement (ABC).pdf'), 'W-2');
  assert.equal(classifyContractType('Employment_Offer_and_Agreement_v2.PDF'), 'W-2');
  assert.equal(classifyContractType('Capital_Infusion_IC_Account_Executive_Agreement.pdf'), '1099');
  assert.equal(classifyContractType('Capital_Infusion_IC_Account_Executive_Agreement (NN).pdf'), '1099');
  assert.equal(isTrackedEmploymentContract('Capital Infusion - Sarah Fondeur.pdf'), false);
  assert.equal(isTrackedEmploymentContract('W9 - Sarah Fondeur.pdf'), false);
  assert.equal(isTrackedEmploymentContract('Summary'), false);
  assert.equal(isTrackedEmploymentContract('random.pdf'), false);
});

test('uses six calendar months with end-of-month clamping', () => {
  assert.equal(addCalendarMonths('2026-08-19T23:00:00Z', 6), '2027-02-19T23:00:00.000Z');
  assert.equal(addCalendarMonths('2024-08-31T12:30:00Z', 6), '2025-02-28T12:30:00.000Z');
  assert.equal(addCalendarMonths('2023-08-31T12:30:00Z', 6), '2024-02-29T12:30:00.000Z');
});

test('a first 1099 contract starts at Tier 1 and certificates never activate lifecycle', () => {
  const contractor = applyCompletedEnvelopeToLifecycle(undefined, envelope(
    'contractor',
    '2026-08-20T00:00:00Z',
    ['Capital_Infusion_IC_Account_Executive_Agreement (NN).pdf'],
  )).lifecycle;
  assert.equal(contractor.currentTier, 1);
  assert.equal(contractor.currentContract.contractType, '1099');

  const certificate = applyCompletedEnvelopeToLifecycle(undefined, {
    envelopeId: 'certificate',
    completedAt: '2026-08-20T00:00:00Z',
    rep,
    documents: [{
      documentId: 'certificate',
      name: 'Employment_Offer_and_Agreement.pdf',
      classification: 'certificate',
      type: 'summary',
    }],
  });
  assert.deepEqual(certificate, { changed: false, lifecycle: undefined });
});

test('historical generated object names can be classified without reading PDF bodies', () => {
  const result = applyCompletedEnvelopeToLifecycle(undefined, {
    envelopeId: 'stored-name-only',
    completedAt: '2026-08-20T00:00:00Z',
    rep,
    documents: [{
      documentId: '1',
      name: '1-Employment_Offer_and_Agreement.pdf',
      storedName: '1-Employment_Offer_and_Agreement.pdf',
      classification: 'signed_document',
    }],
  }).lifecycle;
  assert.equal(result.currentContract.contractType, 'W-2');
});

test('assigns tiers from unique contract envelopes and caps at Tier 3', () => {
  let lifecycle;
  lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, envelope('A', '2026-01-01T00:00:00Z')).lifecycle;
  assert.equal(lifecycle.currentTier, 1);
  assert.equal(lifecycle.currentContract.contractType, 'W-2');
  assert.equal(lifecycle.nextTier, 2);
  const duplicate = applyCompletedEnvelopeToLifecycle(lifecycle, envelope('A', '2026-01-01T00:00:00Z'));
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.lifecycle.contracts.length, 1);
  lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, envelope(
    'B',
    '2026-07-01T00:00:00Z',
    ['Capital_Infusion_IC_Account_Executive_Agreement.pdf'],
  )).lifecycle;
  assert.equal(lifecycle.currentTier, 2);
  assert.equal(lifecycle.currentContract.contractType, '1099');
  assert.equal(lifecycle.contracts[0].status, 'superseded');
  lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, envelope('C', '2027-01-01T00:00:00Z')).lifecycle;
  assert.equal(lifecycle.currentTier, 3);
  assert.equal(lifecycle.nextTier, null);
  lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, envelope('D', '2027-07-01T00:00:00Z')).lifecycle;
  assert.equal(lifecycle.currentTier, 3);
  assert.deepEqual(lifecycle.contracts.map((contract) => contract.tier), [1, 2, 3, 3]);
});

test('unrelated envelopes do not alter lifecycle and multiple tracked PDFs require resolution', () => {
  const unrelated = applyCompletedEnvelopeToLifecycle(undefined, envelope('normal', '2026-01-01', ['W9.pdf', 'NDA.pdf']));
  assert.deepEqual(unrelated, { changed: false, lifecycle: undefined });
  const ambiguous = applyCompletedEnvelopeToLifecycle(undefined, envelope('ambiguous', '2026-01-01', [
    'Employment_Offer_and_Agreement.pdf',
    'Capital_Infusion_IC_Account_Executive_Agreement.pdf',
    'W9.pdf',
  ]));
  assert.equal(ambiguous.lifecycle.currentTier, undefined);
  assert.equal(ambiguous.lifecycle.requiresContractResolution, true);
  assert.equal(ambiguous.lifecycle.contractResolutions[0].trackedDocumentCount, 2);
});

test('historical lifecycle assignment is chronological rather than input order', () => {
  const lifecycle = buildContractLifecycle(rep, [
    envelope('C', '2027-01-01T00:00:00Z'),
    envelope('A', '2026-01-01T00:00:00Z'),
    envelope('B', '2026-07-01T00:00:00Z'),
  ]);
  assert.deepEqual(lifecycle.contracts.map((contract) => [contract.envelopeId, contract.tier]), [
    ['A', 1], ['B', 2], ['C', 3],
  ]);
});

test('historical backfill reads metadata names and rebuilds tier order without document bodies', async () => {
  let saved;
  const metadata = (envelopeId, completedAt, name) => ({
    envelopeId,
    status: 'completed',
    completedAt,
    rep,
    repSource: 'completed_signer',
    documents: [{ documentId: '1', name, classification: 'signed_document' }],
  });
  const service = new ContractLifecycleService({
    storage: {
      listEnvelopeMetadataRecords: async () => [
        metadata('B', '2026-07-01T00:00:00Z', 'Capital_Infusion_IC_Account_Executive_Agreement (ER).pdf'),
        metadata('normal', '2026-02-01T00:00:00Z', 'NDA.pdf'),
        metadata('A', '2026-01-01T00:00:00Z', 'Employment_Offer_and_Agreement (ER).pdf'),
      ],
      updateRepContractLifecycle: async (_repId, mutate) => { saved = mutate(undefined); return saved; },
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2026-08-20T00:00:00Z'),
  });
  assert.deepEqual(await service.backfillFromEnvelopeMetadata(), {
    scannedEnvelopes: 3,
    trackedEnvelopes: 2,
    lifecycleCount: 1,
  });
  assert.deepEqual(saved.contracts.map((contract) => [contract.envelopeId, contract.tier]), [['A', 1], ['B', 2]]);
  assert.deepEqual(saved.contracts.map((contract) => contract.contractType), ['W-2', '1099']);
});

test('historical backfill preserves legacy lifecycle records as unknown', async () => {
  let saved;
  const current = {
    schemaVersion: 1,
    repId: rep.repId,
    repEmail: rep.email,
    repName: rep.name,
    contracts: [{
      envelopeId: 'legacy',
      documentId: '1',
      documentName: 'Capital Infusion - Example Rep.pdf',
      signedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
      tier: 1,
      status: 'active',
    }],
    contractResolutions: [],
  };
  const service = new ContractLifecycleService({
    storage: {
      listEnvelopeMetadataRecords: async () => [{
        envelopeId: 'new-w2',
        completedAt: '2026-07-01T00:00:00Z',
        rep,
        repSource: 'completed_signer',
        documents: [{ documentId: '1', name: 'Employment_Offer_and_Agreement.pdf' }],
      }],
      updateRepContractLifecycle: async (_repId, mutate) => { saved = mutate(current); return saved; },
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2026-08-20T00:00:00Z'),
  });
  await service.backfillFromEnvelopeMetadata();
  assert.deepEqual(saved.contracts.map((contract) => [
    contract.envelopeId,
    contract.contractType,
    contract.tier,
  ]), [
    ['legacy', 'unknown', 1],
    ['new-w2', 'W-2', 2],
  ]);
});

test('historical backfill ignores production-excluded demo metadata', async () => {
  const updates = [];
  const service = new ContractLifecycleService({
    storage: {
      listEnvelopeMetadataRecords: async () => [{
        envelopeId: 'demo',
        rep,
        repSource: 'completed_signer',
        completedAt: '2026-01-01T00:00:00Z',
        documents: [{ documentId: '1', name: 'Employment_Offer_and_Agreement.pdf' }],
      }, {
        envelopeId: 'production',
        rep,
        repSource: 'completed_signer',
        completedAt: '2026-07-01T00:00:00Z',
        documents: [{ documentId: '1', name: 'Employment_Offer_and_Agreement.pdf' }],
      }],
      isEnvelopeExcluded: (metadata) => metadata.envelopeId === 'demo',
      updateRepContractLifecycle: async (repId, mutate) => updates.push({ repId, lifecycle: mutate(undefined) }),
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2026-08-20T00:00:00Z'),
  });
  assert.deepEqual(await service.backfillFromEnvelopeMetadata(), {
    scannedEnvelopes: 1,
    trackedEnvelopes: 1,
    lifecycleCount: 1,
  });
  assert.equal(updates[0].lifecycle.contracts.length, 1);
  assert.equal(updates[0].lifecycle.currentContract.envelopeId, 'production');
});

test('duplicate webhook backfills contract type without changing tier', () => {
  const original = buildContractLifecycle(rep, [envelope('A', '2026-01-01T00:00:00Z')]);
  const legacy = {
    ...original,
    contracts: original.contracts.map(({ contractType: _type, ...contract }) => contract),
    currentContract: undefined,
  };
  legacy.currentContract = legacy.contracts[0];
  const result = applyCompletedEnvelopeToLifecycle(legacy, envelope('A', '2026-01-01T00:00:00Z'));
  assert.equal(result.changed, true);
  assert.equal(result.lifecycle.currentTier, 1);
  assert.equal(result.lifecycle.contracts.length, 1);
  assert.equal(result.lifecycle.currentContract.contractType, 'W-2');
});

test('selects 30, 15, 7, and expiration reminders with nearest missed threshold behavior', () => {
  assert.equal(reminderThresholdForDays(31), undefined);
  assert.equal(reminderThresholdForDays(30), 30);
  assert.equal(reminderThresholdForDays(24), 30);
  assert.equal(reminderThresholdForDays(15), 15);
  assert.equal(reminderThresholdForDays(14), 15);
  assert.equal(reminderThresholdForDays(7), 7);
  assert.equal(reminderThresholdForDays(6), 7);
  assert.equal(reminderThresholdForDays(0), 0);
  assert.equal(reminderThresholdForDays(-2), 0);
});

test('persists reminder identity once and a new contract gets a new schedule', async () => {
  const notifications = new Set();
  const deliveries = [];
  let lifecycle = buildContractLifecycle(rep, [envelope('A', '2026-08-19T00:00:00Z')]);
  const storage = {
    listContractLifecycles: async () => [lifecycle],
    claimContractNotification: async (notification) => {
      if (notifications.has(notification.notificationId)) return false;
      notifications.add(notification.notificationId);
      return true;
    },
    saveContractNotification: async () => {},
    releaseContractNotification: async (id) => notifications.delete(id),
  };
  const emailProvider = {
    assertConfigured() {},
    sendContractReminder: async (message) => { deliveries.push(message); return { messageId: 'message-id' }; },
  };
  const service = new ContractLifecycleService({
    storage,
    logger: { info() {}, warn() {} },
    now: () => new Date('2027-02-05T12:00:00Z'),
  });
  assert.equal((await service.sendEligibleReminders({ emailProvider, recipient: 'notify@example.com' })).sent, 1);
  assert.equal(deliveries[0].daysRemaining, 15);
  assert.equal((await service.sendEligibleReminders({ emailProvider, recipient: 'notify@example.com' })).skipped, 1);

  lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, envelope('B', '2027-02-05T00:00:00Z')).lifecycle;
  const laterService = new ContractLifecycleService({
    storage,
    logger: { info() {}, warn() {} },
    now: () => new Date('2027-07-06T12:00:00Z'),
  });
  assert.equal((await laterService.sendEligibleReminders({ emailProvider, recipient: 'notify@example.com' })).sent, 1);
  assert.deepEqual([...notifications], ['A:15', 'B:30']);
});

test('Resend provider sends simple text with a stable idempotency key', async () => {
  let request;
  const provider = new ResendContractEmailProvider({
    apiKey: 'test-api-key',
    from: 'Contracts <contracts@example.com>',
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: 'email-id' }) };
    },
  });
  const result = await provider.sendContractReminder({
    notificationId: 'envelope:30',
    to: 'notify@example.com',
    rep,
    currentTier: 1,
    nextTier: 2,
    expiresAt: '2027-02-19T00:00:00Z',
    daysRemaining: 30,
  });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers['idempotency-key'], 'contract-reminder/envelope:30');
  assert.equal(body.subject, 'Example Rep contract expires in 30 days');
  assert.equal(body.text.includes('Current Tier: Tier 1'), true);
  assert.equal(body.text.toLowerCase().includes('compensation'), false);
  assert.deepEqual(result, { messageId: 'email-id' });
});

test('retains a notification claim if delivery succeeds but final persistence fails', async () => {
  let released = false;
  const lifecycle = buildContractLifecycle(rep, [envelope('A', '2026-08-19T00:00:00Z')]);
  const service = new ContractLifecycleService({
    storage: {
      listContractLifecycles: async () => [lifecycle],
      claimContractNotification: async () => true,
      saveContractNotification: async () => { throw new Error('storage unavailable'); },
      releaseContractNotification: async () => { released = true; },
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2027-01-20T12:00:00Z'),
  });
  const result = await service.sendEligibleReminders({
    emailProvider: { assertConfigured() {}, sendContractReminder: async () => ({ messageId: 'sent' }) },
    recipient: 'notify@example.com',
  });
  assert.equal(result.failed, 1);
  assert.equal(released, false);
});

test('releases a notification claim when provider delivery fails so it remains retryable', async () => {
  const released = [];
  const saved = [];
  const lifecycle = buildContractLifecycle(rep, [envelope('A', '2026-08-19T00:00:00Z')]);
  const service = new ContractLifecycleService({
    storage: {
      listContractLifecycles: async () => [lifecycle],
      claimContractNotification: async () => true,
      saveContractNotification: async (notification) => saved.push(notification),
      releaseContractNotification: async (notificationId) => released.push(notificationId),
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2027-01-20T12:00:00Z'),
  });
  const result = await service.sendEligibleReminders({
    emailProvider: {
      assertConfigured() {},
      sendContractReminder: async () => {
        const error = new Error('provider unavailable');
        error.code = 'contract_email_delivery_failed';
        throw error;
      },
    },
    recipient: 'notify@example.com',
  });
  assert.equal(result.failed, 1);
  assert.deepEqual(released, ['A:30']);
  assert.deepEqual(saved, []);
});
