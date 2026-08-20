import { createPrivateKey, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertJwtConfiguration } from '../config.js';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeDescription(value, fallback) {
  return String(value || fallback).replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

function accountInformationUrl(baseUri, accountId) {
  const url = new URL(baseUri);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.docusign.net')) {
    throw new DocusignAuthError('invalid_base_uri', 'DocuSign userinfo returned an invalid base URI', {
      phase: 'userinfo',
      privateKeyLoaded: true,
      privateKeyParsed: true,
    });
  }
  return `${url.origin}/restapi/v2.1/accounts/${encodeURIComponent(accountId)}`;
}

export class DocusignAuthError extends Error {
  constructor(code, message, details = {}) {
    super(safeDescription(message, code));
    this.name = 'DocusignAuthError';
    this.code = code;
    Object.assign(this, details);
  }
}

export class DocusignJwtAuth {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetch || globalThis.fetch;
    this.readFile = options.readFile || readFile;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.cachedToken = null;
  }

  async readPrivateKey() {
    try {
      assertJwtConfiguration(this.config);
    } catch (error) {
      throw new DocusignAuthError('configuration_error', error.message, {
        phase: 'configuration',
        privateKeyLoaded: false,
        privateKeyParsed: false,
      });
    }
    let privateKey;
    try {
      privateKey = await this.readFile(this.config.privateKeyPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new DocusignAuthError('private_key_not_found', 'DocuSign RSA private key file not found', {
          phase: 'private-key',
          privateKeyLoaded: false,
          privateKeyParsed: false,
        });
      }
      throw new DocusignAuthError('private_key_read_failed', 'Unable to read DocuSign RSA private key', {
        phase: 'private-key',
        privateKeyLoaded: false,
        privateKeyParsed: false,
      });
    }

    try {
      const parsed = createPrivateKey(privateKey);
      if (!['rsa', 'rsa-pss'].includes(parsed.asymmetricKeyType)) throw new Error('Not an RSA key');
    } catch {
      throw new DocusignAuthError('private_key_invalid', 'Unable to parse DocuSign RSA private key', {
        phase: 'private-key',
        privateKeyLoaded: true,
        privateKeyParsed: false,
      });
    }
    return privateKey;
  }

  async getAccessToken() {
    const now = this.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) return this.cachedToken.value;

    const privateKey = await this.readPrivateKey();
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: this.config.integrationKey,
      sub: this.config.userId,
      aud: this.config.authServer,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    }));
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;

    let response;
    try {
      response = await this.fetch(`https://${this.config.authServer}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
    } catch {
      throw new DocusignAuthError('docusign_unreachable', 'Unable to reach DocuSign OAuth server', {
        phase: 'oauth',
        privateKeyLoaded: true,
        privateKeyParsed: true,
      });
    }
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new DocusignAuthError(
        details.error || 'oauth_error',
        details.error_description || `DocuSign JWT grant failed with HTTP ${response.status}`,
        { phase: 'oauth', upstreamStatus: response.status, privateKeyLoaded: true, privateKeyParsed: true },
      );
    }
    const result = await response.json();
    if (!result.access_token) {
      throw new DocusignAuthError('missing_access_token', 'DocuSign JWT grant returned no access token', {
        phase: 'oauth',
        privateKeyLoaded: true,
        privateKeyParsed: true,
      });
    }
    this.cachedToken = { value: result.access_token, expiresAt: now + Number(result.expires_in || 3600) };
    return this.cachedToken.value;
  }

  async testAuthentication() {
    await this.readPrivateKey();
    const accessToken = await this.getAccessToken();
    let response;
    try {
      response = await this.fetch(`https://${this.config.authServer}/oauth/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
    } catch {
      throw new DocusignAuthError('userinfo_unreachable', 'Unable to reach DocuSign userinfo endpoint', {
        phase: 'userinfo',
        privateKeyLoaded: true,
        privateKeyParsed: true,
      });
    }
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new DocusignAuthError(
        details.error || 'userinfo_failed',
        details.error_description || `DocuSign userinfo failed with HTTP ${response.status}`,
        { phase: 'userinfo', upstreamStatus: response.status, privateKeyLoaded: true, privateKeyParsed: true },
      );
    }

    const result = await response.json();
    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    const account = accounts.find((item) => item.account_id === this.config.accountId) ||
      accounts.find((item) => item.is_default === true || item.is_default === 'true') ||
      accounts[0];
    if (!account) {
      throw new DocusignAuthError('account_not_found', 'DocuSign userinfo returned no account', {
        phase: 'userinfo',
        privateKeyLoaded: true,
        privateKeyParsed: true,
      });
    }

    let apiResponse;
    try {
      apiResponse = await this.fetch(accountInformationUrl(account.base_uri, account.account_id), {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
    } catch (error) {
      if (error instanceof DocusignAuthError) throw error;
      throw new DocusignAuthError('esign_api_unreachable', 'Unable to reach the DocuSign eSignature API', {
        phase: 'esign-api',
        privateKeyLoaded: true,
        privateKeyParsed: true,
        userInfoSucceeded: true,
      });
    }
    if (!apiResponse.ok) {
      throw new DocusignAuthError(
        'esign_api_failed',
        `DocuSign account information request failed with HTTP ${apiResponse.status}`,
        {
          phase: 'esign-api',
          apiStatus: apiResponse.status,
          privateKeyLoaded: true,
          privateKeyParsed: true,
          userInfoSucceeded: true,
        },
      );
    }

    return {
      accountId: account.account_id,
      accountName: account.account_name,
      baseUri: account.base_uri,
      apiStatus: apiResponse.status,
      apiReadSucceeded: true,
      privateKeyLoaded: true,
      privateKeyParsed: true,
    };
  }
}
