export class DocusignClient {
  constructor(config, auth, options = {}) {
    this.config = config;
    this.auth = auth;
    this.fetch = options.fetch || globalThis.fetch;
  }

  apiUrl(path) {
    const root = this.config.baseUrl.endsWith('/restapi')
      ? this.config.baseUrl
      : `${this.config.baseUrl}/restapi`;
    return `${root}/v2.1/accounts/${encodeURIComponent(this.config.accountId)}${path}`;
  }

  async request(path, label, stage) {
    let token;
    try {
      token = await this.auth.getAccessToken();
    } catch (error) {
      error.stage = 'authentication';
      throw error;
    }
    const response = await this.fetch(this.apiUrl(path), {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!response.ok) {
      const details = await response.text();
      const error = new Error(`${label} failed (${response.status}): ${details.slice(0, 300)}`);
      error.stage = stage;
      throw error;
    }
    return response;
  }

  async getEnvelope(envelopeId) {
    return (await this.request(`/envelopes/${encodeURIComponent(envelopeId)}`, 'Envelope lookup', 'envelope-metadata')).json();
  }

  async listDocuments(envelopeId) {
    const result = await (await this.request(
      `/envelopes/${encodeURIComponent(envelopeId)}/documents`,
      'Document list',
      'document-list',
    )).json();
    return result.envelopeDocuments || [];
  }

  async listRecipients(envelopeId) {
    return (await this.request(
      `/envelopes/${encodeURIComponent(envelopeId)}/recipients`,
      'Recipient list',
      'recipient-list',
    )).json();
  }

  async downloadDocument(envelopeId, documentId) {
    return Buffer.from(await (await this.request(
      `/envelopes/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}`,
      'Document download',
      'document-download',
    )).arrayBuffer());
  }
}
