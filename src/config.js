import path from 'node:path';

function boolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received ${value}`);
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(environment = process.env) {
  return {
    port: positiveInteger(environment.PORT, 3000, 'PORT'),
    logLevel: environment.LOG_LEVEL || 'info',
    docusign: {
      integrationKey: environment.DOCUSIGN_INTEGRATION_KEY || '',
      userId: environment.DOCUSIGN_USER_ID || '',
      accountId: environment.DOCUSIGN_ACCOUNT_ID || '',
      privateKeyPath: environment.DOCUSIGN_PRIVATE_KEY_PATH || '',
      authServer: environment.DOCUSIGN_AUTH_SERVER || 'account-d.docusign.com',
      baseUrl: (environment.DOCUSIGN_BASE_URL || 'https://demo.docusign.net').replace(/\/$/, ''),
      allowedSenders: new Set(
        (environment.DOCUSIGN_ALLOWED_SENDERS || '')
          .split(',')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
      hmacSecret: environment.DOCUSIGN_CONNECT_HMAC_SECRET || '',
      requireHmac: boolean(environment.DOCUSIGN_REQUIRE_HMAC, true),
      storageDir: path.resolve(environment.DOCUSIGN_STORAGE_DIR || './data/docusign'),
      maxWebhookBytes: positiveInteger(
        environment.DOCUSIGN_MAX_WEBHOOK_BYTES,
        1024 * 1024,
        'DOCUSIGN_MAX_WEBHOOK_BYTES',
      ),
    },
  };
}

export function assertApiConfiguration(config) {
  const required = [
    ['DOCUSIGN_INTEGRATION_KEY', config.integrationKey],
    ['DOCUSIGN_USER_ID', config.userId],
    ['DOCUSIGN_ACCOUNT_ID', config.accountId],
    ['DOCUSIGN_PRIVATE_KEY_PATH', config.privateKeyPath],
    ['DOCUSIGN_BASE_URL', config.baseUrl],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing DocuSign configuration: ${missing.join(', ')}`);
}
