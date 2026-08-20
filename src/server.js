import { createServer } from 'node:http';
import { loadConfig, missingApiConfiguration } from './config.js';
import { createLogger } from './logger.js';
import { DocusignJwtAuth } from './docusign/auth.js';
import { DocusignClient } from './docusign/client.js';
import { createStorageProvider } from './docusign/storage-provider.js';
import { CompletedEnvelopeProcessor } from './docusign/processor.js';
import { migrateSignerRepMetadata } from './docusign/rep-migration.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const auth = new DocusignJwtAuth(config.docusign);
const client = new DocusignClient(config.docusign, auth);
const storage = createStorageProvider(config);
const processor = new CompletedEnvelopeProcessor({
  client,
  storage,
  allowedSenders: config.docusign.allowedSenders,
  logger,
});
const server = createServer(createApp({ config, storage, processor, auth, logger }));

logger.info('Storage provider selected', {
  provider: storage.provider === 'r2' ? 'Cloudflare R2' : 'local filesystem',
  bucket: storage.provider === 'r2' ? storage.bucket : undefined,
});

const missing = missingApiConfiguration(config.docusign);
if (config.docusign.requireHmac && !config.docusign.hmacSecret) {
  missing.push('DOCUSIGN_CONNECT_HMAC_SECRET');
}
if (missing.length) {
  logger.warn('DocuSign processing is not fully configured; health check remains available', {
    missingEnvironmentVariables: missing,
  });
}

server.listen(config.port, '0.0.0.0', () => {
  logger.info('Server listening', { port: config.port, host: '0.0.0.0' });
  void migrateSignerRepMetadata({ client, storage, logger })
    .then((result) => logger.info('DocuSign signer-rep metadata migration finished', result))
    .catch((error) => logger.warn('DocuSign signer-rep metadata migration could not finish', {
      stage: error.stage || 'recipient-migration',
    }));
});
