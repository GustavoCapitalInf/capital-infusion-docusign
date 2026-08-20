import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  connectHmacDiagnostics,
  isCompletedEnvelope,
  parseAndNormalizeWebhook,
  verifyConnectHmac,
} from '../src/docusign/webhook.js';

test('normalizes a current Connect JSON envelope-completed payload', () => {
  const body = Buffer.from(JSON.stringify({
    event: 'envelope-completed',
    generatedDateTime: '2026-08-19T12:00:00Z',
    data: {
      envelopeId: 'env-123',
      envelopeSummary: {
        status: 'completed',
        sender: { email: 'hr@capital-infusion.com' },
      },
    },
  }));
  const event = parseAndNormalizeWebhook(body, 'application/json');
  assert.deepEqual(event, {
    provider: 'docusign',
    event: 'envelope-completed',
    envelopeId: 'env-123',
    status: 'completed',
    senderEmail: 'hr@capital-infusion.com',
    timestamp: '2026-08-19T12:00:00Z',
  });
  assert.equal(isCompletedEnvelope(event), true);
});

test('normalizes a legacy XML completed-envelope payload', () => {
  const body = Buffer.from(`<?xml version="1.0"?><DocuSignEnvelopeInformation>
    <EnvelopeStatus><EnvelopeID>env-xml</EnvelopeID><Status>Completed</Status>
    <Sender><Email>sender@example.com</Email></Sender><Completed>2026-08-19T12:00:00Z</Completed>
    </EnvelopeStatus></DocuSignEnvelopeInformation>`);
  const event = parseAndNormalizeWebhook(body, 'application/xml');
  assert.equal(event.envelopeId, 'env-xml');
  assert.equal(event.status, 'completed');
  assert.equal(event.event, 'envelope-completed');
  assert.equal(event.senderEmail, 'sender@example.com');
});

test('validates HMAC against the unchanged raw body', () => {
  const body = Buffer.from('{"event":"envelope-completed"}');
  const signature = createHmac('sha256', 'shared-secret').update(body).digest('base64');
  assert.equal(verifyConnectHmac(body, { 'x-docusign-signature-1': signature }, 'shared-secret'), true);
  assert.equal(verifyConnectHmac(Buffer.concat([body, Buffer.from(' ')]), { 'x-docusign-signature-1': signature }, 'shared-secret'), false);
  assert.equal(verifyConnectHmac(body, {}, '', true), false);
  assert.equal(verifyConnectHmac(body, {}, '', false), true);
});

test('accepts case-insensitive signature headers and reports safe diagnostics', () => {
  const body = Buffer.from('{"lineEndings":"must remain exact"}\r\n');
  const signature = createHmac('sha256', 'shared-secret').update(body).digest('base64');
  const headers = {
    'Content-Type': 'application/json',
    'X-DocuSign-Signature-1': signature,
    'X-DocuSign-Signature-2': 'another-signature',
  };
  assert.equal(verifyConnectHmac(body, headers, 'shared-secret'), true);
  assert.deepEqual(connectHmacDiagnostics(body, headers, 'shared-secret', true, 'application/json'), {
    contentType: 'application/json',
    rawBodyIsBuffer: true,
    rawBodyByteLength: body.length,
    signature1Present: true,
    signatureHeaderCount: 2,
    hmacSecretConfigured: true,
    hmacValidationResult: true,
  });
  assert.equal(verifyConnectHmac(Buffer.from(body.toString().trim()), headers, 'shared-secret'), false);
});
