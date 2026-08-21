import { S3Client } from '@aws-sdk/client-s3';
import { assertR2Configuration, hasR2Configuration } from '../config.js';
import { FileStorage } from './storage.js';
import { R2Storage } from './r2-storage.js';
import { createDemoEnvelopePolicy } from './demo.js';

export function createStorageProvider(config, options = {}) {
  const demoPolicy = createDemoEnvelopePolicy(config.docusign);
  if (!hasR2Configuration(config.r2)) return new FileStorage(config.docusign.storageDir, { demoPolicy });
  assertR2Configuration(config.r2);
  const client = options.r2Client || new S3Client({
    region: 'auto',
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
  return new R2Storage({ client, bucket: config.r2.bucket, demoPolicy });
}
