import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertApiConfiguration } from '../config.js';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

export class DocusignJwtAuth {
  constructor(config, options = {}) {
    this.config = config;
    this.fetch = options.fetch || globalThis.fetch;
    this.readFile = options.readFile || readFile;
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.cachedToken = null;
  }

  async getAccessToken() {
    assertApiConfiguration(this.config);
    const now = this.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) return this.cachedToken.value;

    const privateKey = await this.readFile(this.config.privateKeyPath, 'utf8');
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

    const response = await this.fetch(`https://${this.config.authServer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`DocuSign JWT grant failed (${response.status}): ${details.slice(0, 300)}`);
    }
    const result = await response.json();
    if (!result.access_token) throw new Error('DocuSign JWT grant returned no access token');
    this.cachedToken = { value: result.access_token, expiresAt: now + Number(result.expires_in || 3600) };
    return this.cachedToken.value;
  }
}
