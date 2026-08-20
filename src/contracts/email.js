function formatExpiration(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

function reminderCopy({ rep, currentTier, nextTier, expiresAt, daysRemaining }) {
  const timing = daysRemaining === 0 ? 'today' : `in ${daysRemaining} days`;
  const expiration = formatExpiration(expiresAt);
  return {
    subject: `${rep.name} contract expires ${timing}`,
    text: [
      `${rep.name}'s contract expires ${timing}${daysRemaining === 0 ? ',' : ' on'} ${expiration}.`,
      '',
      `Current Tier: Tier ${currentTier}`,
      `Next Tier: ${nextTier ? `Tier ${nextTier}` : 'None'}`,
      `Rep Email: ${rep.email}`,
    ].join('\n'),
  };
}

function expirationDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function optionalJson(response) {
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class PowerAutomateContractEmailProvider {
  constructor({ url, fetch = globalThis.fetch, timeoutMs = 20_000 }) {
    this.url = url;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
    this.name = 'power-automate';
  }

  assertConfigured(recipient) {
    const missing = [];
    if (!recipient) missing.push('CONTRACT_NOTIFICATION_EMAIL');
    if (!this.url) missing.push('CONTRACT_POWER_AUTOMATE_URL');
    if (missing.length) {
      const error = new Error(
        `Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      );
      error.code = 'contract_email_not_configured';
      throw error;
    }
  }

  async sendContractReminder(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repName: input.rep.name,
          repEmail: input.rep.email,
          daysRemaining: input.daysRemaining,
          expirationDate: expirationDate(input.expiresAt),
          currentTier: input.currentTier,
          nextTier: input.nextTier ?? null,
          notificationId: input.notificationId,
        }),
        signal: controller.signal,
      });

      const successfulStatus = response.ok ?? (response.status >= 200 && response.status < 300);
      if (!successfulStatus) {
        const error = new Error(`Contract reminder email failed (${response.status})`);
        error.code = 'contract_email_delivery_failed';
        throw error;
      }

      const body = await optionalJson(response);
      if (body?.success === false) {
        const error = new Error('Power Automate reported email delivery failure');
        error.code = 'contract_email_delivery_failed';
        throw error;
      }
      return { messageId: body?.messageId || body?.id, status: response.status };
    } catch (cause) {
      if (cause?.code === 'contract_email_delivery_failed') throw cause;
      const error = new Error(
        controller.signal.aborted ? 'Power Automate request timed out' : 'Power Automate request failed',
      );
      error.code = controller.signal.aborted ? 'contract_email_timeout' : 'contract_email_delivery_failed';
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ResendContractEmailProvider {
  constructor({ apiKey, from, fetch = globalThis.fetch }) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetch = fetch;
    this.name = 'resend';
  }

  assertConfigured(recipient) {
    const missing = [];
    if (!recipient) missing.push('CONTRACT_NOTIFICATION_EMAIL');
    if (!this.from) missing.push('CONTRACT_EMAIL_FROM');
    if (!this.apiKey) missing.push('RESEND_API_KEY');
    if (missing.length) {
      const error = new Error(`Missing contract email configuration: ${missing.join(', ')}`);
      error.code = 'contract_email_not_configured';
      throw error;
    }
  }

  async sendContractReminder(input) {
    const copy = reminderCopy(input);
    const response = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `contract-reminder/${input.notificationId}`,
      },
      body: JSON.stringify({ from: this.from, to: [input.to], subject: copy.subject, text: copy.text }),
    });
    if (!response.ok) {
      const error = new Error(`Contract reminder email failed (${response.status})`);
      error.code = 'contract_email_delivery_failed';
      throw error;
    }
    const body = await response.json();
    return { messageId: body.id };
  }
}

export function createContractEmailProvider(config, options = {}) {
  if (config.provider === 'power-automate') {
    return new PowerAutomateContractEmailProvider({
      url: config.powerAutomateUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    });
  }
  if (config.provider === 'resend') {
    return new ResendContractEmailProvider({
      apiKey: config.resendApiKey,
      from: config.from,
      fetch: options.fetch,
    });
  }
  throw new Error(`Unsupported contract email provider: ${config.provider}`);
}
