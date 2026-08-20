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
  if (config.provider !== 'resend') throw new Error(`Unsupported contract email provider: ${config.provider}`);
  return new ResendContractEmailProvider({
    apiKey: config.resendApiKey,
    from: config.from,
    fetch: options.fetch,
  });
}
