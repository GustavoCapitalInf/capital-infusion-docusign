import {
  connectHmacDiagnostics,
  parseAndNormalizeWebhook,
  isCompletedEnvelope,
  verifyConnectHmac,
} from './docusign/webhook.js';
import { documentsPage } from './documents-ui.js';
import { normalizeEmail } from './docusign/rep.js';

function json(response, status, body) {
  const contents = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(contents) });
  response.end(contents);
}

function html(response, contents) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(contents) });
  response.end(contents);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function normalizeRepId(value) {
  if (['unassigned', 'requires-resolution'].includes(value)) return value;
  return normalizeEmail(value) || undefined;
}

function validEnvelopeId(value) {
  return /^[a-zA-Z0-9-]{1,100}$/.test(value || '');
}

function validDocumentId(value) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(value || '');
}

function filterAndSortReps(reps, url) {
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const sort = url.searchParams.get('sort') || 'recent';
  const filtered = search
    ? reps.filter((rep) => `${rep.name || ''} ${rep.email || ''}`.toLowerCase().includes(search))
    : [...reps];
  return filtered.sort((a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (sort === 'count') return b.completedEnvelopeCount - a.completedEnvelopeCount;
    return String(b.latestCompletedAt || '').localeCompare(String(a.latestCompletedAt || ''));
  });
}

function filterAndSortEnvelopes(envelopes, url) {
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const sort = url.searchParams.get('sort') || 'newest';
  const filtered = search
    ? envelopes.filter((envelope) => `${envelope.primaryDocumentName || ''} ${envelope.envelopeId} ${envelope.completedAt || ''}`
      .toLowerCase().includes(search))
    : [...envelopes];
  return filtered.sort((a, b) => {
    if (sort === 'oldest') return String(a.completedAt || '').localeCompare(String(b.completedAt || ''));
    if (sort === 'name') return String(a.primaryDocumentName || '').localeCompare(String(b.primaryDocumentName || ''));
    return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
  });
}

async function streamDocument(response, result, download) {
  const filename = String(result.document.name || 'document.pdf').replace(/["\r\n]/g, '_');
  response.writeHead(200, {
    'content-type': result.contentType,
    ...(result.contentLength ? { 'content-length': result.contentLength } : {}),
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  for await (const chunk of result.body) response.write(chunk);
  response.end();
}

async function catalogResponse(response, logger, action) {
  try {
    return await action();
  } catch (error) {
    logger.error('Document catalog request failed', { error: error.message });
    if (!response.headersSent) {
      return json(response, 500, {
        error: error.message === 'Corrupted envelope metadata'
          ? 'Corrupted envelope metadata'
          : 'Document catalog request failed',
      });
    }
    response.destroy(error);
  }
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

export function createApp({ config, storage, processor, auth, contractLifecycle, logger }) {
  let latestHmacDiagnostics;
  return async function app(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' });
    if (request.method === 'GET' && (
      url.pathname === '/documents' ||
      /^\/documents\/reps\/[^/]+$/.test(url.pathname) ||
      /^\/documents\/envelopes\/[^/]+$/.test(url.pathname)
    )) return html(response, documentsPage);
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
    if (request.method === 'POST' && url.pathname === '/api/storage/test-r2') {
      if (storage.provider !== 'r2') {
        return json(response, 400, { success: false, provider: storage.provider, error: 'R2 configuration missing' });
      }
      try {
        return json(response, 200, await storage.testConnectivity());
      } catch (error) {
        logger.error('R2 connectivity test failed', { error: error.code || 'r2_connectivity_failure' });
        return json(response, 502, {
          success: false,
          provider: 'r2',
          bucket: storage.bucket,
          error: error.code || 'r2_connectivity_failure',
          message: error.message,
        });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/reps') {
      return catalogResponse(response, logger, async () => {
        const reps = await storage.listReps();
        const enriched = contractLifecycle ? await contractLifecycle.enrichReps(reps) : reps;
        return json(response, 200, { reps: filterAndSortReps(enriched, url) });
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/contracts/renewals') {
      if (!contractLifecycle) return json(response, 200, { renewals: [] });
      return catalogResponse(response, logger, async () =>
        json(response, 200, { renewals: await contractLifecycle.listRenewals(30) }));
    }
    const contractMatch = request.method === 'GET' && url.pathname.match(/^\/api\/reps\/([^/]+)\/contract$/);
    if (contractMatch) {
      const repId = normalizeRepId(safeDecode(contractMatch[1]));
      if (!repId) return json(response, 400, { error: 'Invalid rep ID' });
      if (!contractLifecycle) return json(response, 404, { error: 'Contract lifecycle not found' });
      return catalogResponse(response, logger, async () => {
        const contract = await contractLifecycle.getRepContract(repId);
        return contract
          ? json(response, 200, contract)
          : json(response, 404, { error: 'Contract lifecycle not found' });
      });
    }
    const repMatch = request.method === 'GET' && url.pathname.match(/^\/api\/reps\/([^/]+)\/envelopes$/);
    if (repMatch) {
      const repId = safeDecode(repMatch[1]);
      const normalizedRepId = normalizeRepId(repId);
      if (!normalizedRepId) return json(response, 400, { error: 'Invalid rep ID' });
      return catalogResponse(response, logger, async () => {
        const result = await storage.listRepEnvelopes(normalizedRepId);
        if (!result) return json(response, 404, { error: 'Rep not found' });
        const contract = contractLifecycle ? await contractLifecycle.getRepContract(normalizedRepId) : undefined;
        return json(response, 200, {
          rep: result.rep,
          contract,
          envelopes: filterAndSortEnvelopes(result.envelopes, url),
        });
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/docusign/envelopes') {
      return catalogResponse(response, logger, async () =>
        json(response, 200, { envelopes: filterAndSortEnvelopes(await storage.listEnvelopes(), url) }));
    }
    const documentMatch = request.method === 'GET' && url.pathname.match(
      /^\/api\/docusign\/envelopes\/([^/]+)\/documents\/([^/]+)$/,
    );
    if (documentMatch) {
      const envelopeId = safeDecode(documentMatch[1]);
      const documentId = safeDecode(documentMatch[2]);
      if (!validEnvelopeId(envelopeId) || !validDocumentId(documentId)) {
        return json(response, 400, { error: 'Invalid envelope or document ID' });
      }
      return catalogResponse(response, logger, async () => {
        const result = await storage.getDocument(envelopeId, documentId);
        if (!result) return json(response, 404, { error: 'Document not found' });
        return streamDocument(response, result, url.searchParams.get('download') === 'true');
      });
    }
    const envelopeMatch = request.method === 'GET' && url.pathname.match(/^\/api\/docusign\/envelopes\/([^/]+)$/);
    if (envelopeMatch) {
      const envelopeId = safeDecode(envelopeMatch[1]);
      if (!validEnvelopeId(envelopeId)) return json(response, 400, { error: 'Invalid envelope ID' });
      return catalogResponse(response, logger, async () => {
        const envelope = await storage.getEnvelope(envelopeId);
        return envelope
          ? json(response, 200, envelope)
          : json(response, 404, { error: 'Envelope not found' });
      });
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
