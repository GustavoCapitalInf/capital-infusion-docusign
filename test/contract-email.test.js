import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PowerAutomateContractEmailProvider,
  ResendContractEmailProvider,
  createContractEmailProvider,
} from '../src/contracts/email.js';

const reminder = {
  notificationId: 'envelope-id:30',
  to: 'notify@example.com',
  rep: { name: 'Example Rep', email: 'rep@example.com' },
  currentTier: 1,
  nextTier: 2,
  expiresAt: '2027-02-19T18:30:00.000Z',
  daysRemaining: 30,
};

test('selects Power Automate without requiring Resend configuration', () => {
  const provider = createContractEmailProvider({
    provider: 'power-automate',
    powerAutomateUrl: 'https://example.invalid/flow?secret=value',
    from: '',
    resendApiKey: '',
  });
  assert.equal(provider instanceof PowerAutomateContractEmailProvider, true);
  assert.doesNotThrow(() => provider.assertConfigured('notify@example.com'));
});

test('retains the optional Resend provider', () => {
  const provider = createContractEmailProvider({
    provider: 'resend',
    from: 'Contracts <contracts@example.com>',
    resendApiKey: 'test-key',
  });
  assert.equal(provider instanceof ResendContractEmailProvider, true);
});

test('Power Automate provider sends the exact safe reminder payload', async () => {
  let request;
  const provider = new PowerAutomateContractEmailProvider({
    url: 'https://example.invalid/flow?secret=do-not-copy',
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, id: 'flow-run-id' }) };
    },
  });

  assert.deepEqual(await provider.sendContractReminder(reminder), { messageId: 'flow-run-id', status: 200 });
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.headers, { 'content-type': 'application/json' });
  assert.equal(request.options.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(request.options.body), {
    repName: 'Example Rep',
    repEmail: 'rep@example.com',
    daysRemaining: 30,
    expirationDate: '2027-02-19',
    currentTier: 1,
    nextTier: 2,
    notificationId: 'envelope-id:30',
  });
  assert.equal(request.options.body.includes('notify@example.com'), false);
  assert.equal(request.options.body.includes('do-not-copy'), false);
});

for (const status of [200, 201, 202, 204]) {
  test(`Power Automate provider accepts HTTP ${status}`, async () => {
    const provider = new PowerAutomateContractEmailProvider({
      url: 'https://example.invalid/flow',
      fetch: async () => ({ ok: true, status, text: async () => '' }),
    });
    assert.deepEqual(await provider.sendContractReminder(reminder), { messageId: undefined, status });
  });
}

for (const status of [400, 500]) {
  test(`Power Automate provider rejects HTTP ${status}`, async () => {
    const provider = new PowerAutomateContractEmailProvider({
      url: 'https://example.invalid/flow',
      fetch: async () => ({ ok: false, status, text: async () => '' }),
    });
    await assert.rejects(provider.sendContractReminder(reminder), (error) => {
      assert.equal(error.code, 'contract_email_delivery_failed');
      assert.equal(error.message, `Contract reminder email failed (${status})`);
      return true;
    });
  });
}

test('Power Automate provider rejects an explicit failure in a 2xx response', async () => {
  const provider = new PowerAutomateContractEmailProvider({
    url: 'https://example.invalid/flow',
    fetch: async () => ({ ok: true, status: 200, text: async () => '{"success":false}' }),
  });
  await assert.rejects(provider.sendContractReminder(reminder), { code: 'contract_email_delivery_failed' });
});

test('Power Automate provider converts network errors to safe retryable errors', async () => {
  const secretUrl = 'https://example.invalid/flow?sig=private-value';
  const provider = new PowerAutomateContractEmailProvider({
    url: secretUrl,
    fetch: async () => { throw new Error(`fetch failed for ${secretUrl}`); },
  });
  await assert.rejects(provider.sendContractReminder(reminder), (error) => {
    assert.equal(error.code, 'contract_email_delivery_failed');
    assert.equal(error.message.includes(secretUrl), false);
    assert.equal(error.message.includes('private-value'), false);
    return true;
  });
});

test('Power Automate provider aborts requests after its timeout', async () => {
  const provider = new PowerAutomateContractEmailProvider({
    url: 'https://example.invalid/flow',
    timeoutMs: 5,
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await assert.rejects(provider.sendContractReminder(reminder), {
    code: 'contract_email_timeout',
    message: 'Power Automate request timed out',
  });
});

test('Power Automate provider reports missing URL by variable name only', () => {
  const provider = new PowerAutomateContractEmailProvider({ url: '' });
  assert.throws(
    () => provider.assertConfigured('notify@example.com'),
    (error) => {
      assert.equal(error.code, 'contract_email_not_configured');
      assert.equal(error.message, 'Missing required environment variable: CONTRACT_POWER_AUTOMATE_URL');
      return true;
    },
  );
});
