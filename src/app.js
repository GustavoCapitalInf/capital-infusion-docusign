import {
  connectHmacDiagnostics,
  parseAndNormalizeWebhook,
  isCompletedEnvelope,
  verifyConnectHmac,
} from './docusign/webhook.js';

function json(response, status, body) {
  const contents = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(contents) });
  response.end(contents);
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Webhook body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createApp({ config, storage, processor, auth, logger }) {
  let latestHmacDiagnostics;
  return async function app(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' });
    if (request.method === 'GET' && url.pathname === '/api/docusign/test-auth') {
      try {
        const result = await auth.testAuthentication();
        logger.info('DocuSign JWT authentication test succeeded', {
          accountId: result.accountId,
          baseUri: result.baseUri,
        });
        return json(response, 200, {
          success: true,
          authenticated: true,
          accountId: result.accountId,
          accountName: result.accountName,
          baseUri: result.baseUri,
        });
      } catch (error) {
        const safeError = error.code || 'authentication_test_failed';
        logger.warn('DocuSign JWT authentication test failed', {
          error: safeError,
          phase: error.phase,
          privateKeyLoaded: error.privateKeyLoaded,
          privateKeyParsed: error.privateKeyParsed,
        });
        return json(response, ['configuration', 'private-key'].includes(error.phase) ? 500 : 502, {
          success: false,
          authenticated: false,
          error: safeError,
          message: error.message,
          privateKeyLoaded: error.privateKeyLoaded ?? false,
          privateKeyParsed: error.privateKeyParsed ?? false,
          userInfoSucceeded: false,
        });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/docusign/hmac-diagnostics') {
      return json(response, 200, latestHmacDiagnostics || { available: false });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/webhooks/docusign') return json(response, 404, { error: 'Not found' });

    try {
      const rawBody = await readBody(request, config.docusign.maxWebhookBytes);
      const hmacValid = verifyConnectHmac(
        rawBody,
        request.headers,
        config.docusign.hmacSecret,
        config.docusign.requireHmac,
      );
      latestHmacDiagnostics = {
        available: true,
        receivedAt: new Date().toISOString(),
        ...connectHmacDiagnostics(
          rawBody,
          request.headers,
          config.docusign.hmacSecret,
          hmacValid,
          request.headers['content-type'] || '',
        ),
      };
      logger.info('DocuSign webhook HMAC diagnostics', latestHmacDiagnostics);
      if (!hmacValid) {
        logger.warn('Invalid DocuSign webhook signature');
        return json(response, 401, { error: 'Invalid webhook signature' });
      }

      const event = parseAndNormalizeWebhook(rawBody, request.headers['content-type'] || '');
      logger.info('DocuSign webhook received', {
        event: event.event || undefined,
        envelopeId: event.envelopeId,
        status: event.status,
        senderEmail: event.senderEmail,
        eventTimestamp: event.timestamp,
      });
      if (!isCompletedEnvelope(event)) {
        logger.info('Unsupported DocuSign event', { event: event.event || undefined, status: event.status });
        return json(response, 202, { accepted: true, processed: false });
      }
      if (!event.envelopeId) {
        logger.warn('DocuSign webhook missing envelope ID');
        return json(response, 400, { error: 'Missing envelope ID' });
      }

      const claim = await storage.claim(event);
      if (!claim.claimed) {
        logger.info('Duplicate DocuSign event ignored', { envelopeId: event.envelopeId, event: event.event });
        return json(response, 200, { accepted: true, duplicate: true });
      }

      json(response, 202, { accepted: true });
      setImmediate(() => {
        processor.process(event, claim).catch((error) => {
          logger.error('Unexpected DocuSign background-processing failure', {
            envelopeId: event.envelopeId,
            error: error.message,
          });
        });
      });
    } catch (error) {
      logger.warn('Invalid DocuSign webhook', { error: error.message });
      if (!response.headersSent) json(response, error.statusCode || 400, { error: error.message });
    }
  };
}
