import { createHmac, timingSafeEqual } from 'node:crypto';

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function textFromXml(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([^<]*?)(?:\\]\\]>)?</(?:[\\w-]+:)?${name}>`, 'i'));
    if (match) return decodeXml(match[1].trim());
  }
  return undefined;
}

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function normalizeJson(payload) {
  const summary = first(payload?.data?.envelopeSummary, payload?.envelopeSummary, payload?.EnvelopeStatus) || {};
  const sender = first(summary.sender, payload?.data?.sender, payload?.sender) || {};
  const event = first(payload?.event, payload?.eventType, payload?.Event);
  const status = first(summary.status, payload?.data?.envelopeStatus, payload?.status);
  return {
    provider: 'docusign',
    event: String(event || (String(status).toLowerCase() === 'completed' ? 'envelope-completed' : '')).toLowerCase(),
    envelopeId: first(payload?.data?.envelopeId, summary.envelopeId, payload?.envelopeId),
    status: status ? String(status).toLowerCase() : undefined,
    senderEmail: first(sender.email, sender.emailAddress, summary.senderEmail, payload?.data?.senderEmail),
    timestamp: first(payload?.generatedDateTime, payload?.createdDateTime, summary.completedDateTime, summary.statusChangedDateTime),
  };
}

function normalizeXml(xml) {
  const status = textFromXml(xml, ['Status', 'EnvelopeStatus']);
  const senderSection = xml.match(/<(?:[\w-]+:)?Sender(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?Sender>/i)?.[1] || '';
  return {
    provider: 'docusign',
    event: String(textFromXml(xml, ['Event', 'EventType']) || (status?.toLowerCase() === 'completed' ? 'envelope-completed' : '')).toLowerCase(),
    envelopeId: textFromXml(xml, ['EnvelopeID', 'EnvelopeId']),
    status: status?.toLowerCase(),
    senderEmail: textFromXml(senderSection, ['Email', 'SenderEmail']) || textFromXml(xml, ['SenderEmail']),
    timestamp: textFromXml(xml, ['TimeGenerated', 'GeneratedDateTime', 'Completed']),
  };
}

export function parseAndNormalizeWebhook(rawBody, contentType = '') {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) throw new Error('Webhook body is empty');
  const body = rawBody.toString('utf8');
  const isJson = contentType.includes('json') || body.trimStart().startsWith('{');
  if (isJson) return normalizeJson(JSON.parse(body));
  if (contentType.includes('xml') || body.trimStart().startsWith('<')) return normalizeXml(body);
  throw new Error('Unsupported webhook content type');
}

export function isCompletedEnvelope(event) {
  return event.event === 'envelope-completed' ||
    (event.status === 'completed' && (!event.event || event.event.includes('envelope')));
}

export function verifyConnectHmac(rawBody, headers, secret, required = true) {
  const signatures = [1, 2, 3, 4, 5]
    .map((number) => headers[`x-docusign-signature-${number}`])
    .filter(Boolean)
    .flatMap((value) => Array.isArray(value) ? value : [value]);

  if (!secret) return !required;
  if (!signatures.length) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return signatures.some((signature) => {
    try {
      const actual = Buffer.from(signature, 'base64');
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  });
}
