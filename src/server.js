import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { DocusignJwtAuth } from './docusign/auth.js';
import { DocusignClient } from './docusign/client.js';
import { FileStorage } from './docusign/storage.js';
import { CompletedEnvelopeProcessor } from './docusign/processor.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const auth = new DocusignJwtAuth(config.docusign);
const client = new DocusignClient(config.docusign, auth);
const storage = new FileStorage(config.docusign.storageDir);
const processor = new CompletedEnvelopeProcessor({
  client,
  storage,
  allowedSenders: config.docusign.allowedSenders,
  logger,
});
const server = createServer(createApp({ config, storage, processor, logger }));

server.listen(config.port, () => logger.info('Server listening', { port: config.port }));
