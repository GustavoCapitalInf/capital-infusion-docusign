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

function string(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export function loadConfig(environment = process.env) {
  return {
    port: positiveInteger(environment.PORT, 3000, 'PORT'),
    logLevel: string(environment.LOG_LEVEL, 'info'),
    docusign: {
      integrationKey: string(environment.DOCUSIGN_INTEGRATION_KEY),
      userId: string(environment.DOCUSIGN_USER_ID),
      accountId: string(environment.DOCUSIGN_ACCOUNT_ID),
      privateKeyPath: string(environment.DOCUSIGN_PRIVATE_KEY_PATH),
      authServer: string(environment.DOCUSIGN_AUTH_SERVER, 'account-d.docusign.com'),
      baseUrl: string(environment.DOCUSIGN_BASE_URL, 'https://demo.docusign.net').replace(/\/$/, ''),
      allowedSenders: new Set(
        (environment.DOCUSIGN_ALLOWED_SENDERS || '')
          .split(',')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
      hmacSecret: string(environment.DOCUSIGN_CONNECT_HMAC_SECRET),
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

export function missingApiConfiguration(config) {
  const required = [
    ['DOCUSIGN_INTEGRATION_KEY', config.integrationKey],
    ['DOCUSIGN_USER_ID', config.userId],
    ['DOCUSIGN_ACCOUNT_ID', config.accountId],
    ['DOCUSIGN_PRIVATE_KEY_PATH', config.privateKeyPath],
    ['DOCUSIGN_BASE_URL', config.baseUrl],
  ];
  return required.filter(([, value]) => !value).map(([name]) => name);
}

export function missingJwtConfiguration(config) {
  const required = [
    ['DOCUSIGN_INTEGRATION_KEY', config.integrationKey],
    ['DOCUSIGN_USER_ID', config.userId],
    ['DOCUSIGN_PRIVATE_KEY_PATH', config.privateKeyPath],
    ['DOCUSIGN_AUTH_SERVER', config.authServer],
  ];
  return required.filter(([, value]) => !value).map(([name]) => name);
}

export function assertJwtConfiguration(config) {
  const missing = missingJwtConfiguration(config);
  if (missing.length) {
    throw new Error(`Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
}

export function assertApiConfiguration(config) {
  const missing = missingApiConfiguration(config);
  if (missing.length) {
    throw new Error(`Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
}
