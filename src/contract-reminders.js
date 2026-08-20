import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createStorageProvider } from './docusign/storage-provider.js';
import { ContractLifecycleService } from './contracts/service.js';
import { createContractEmailProvider } from './contracts/email.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const storage = createStorageProvider(config);
const contractLifecycle = new ContractLifecycleService({ storage, logger });
const emailProvider = createContractEmailProvider({
  provider: config.contracts.emailProvider,
  from: config.contracts.emailFrom,
  resendApiKey: config.contracts.resendApiKey,
});

try {
  logger.info('Contract reminder scan started', { provider: storage.provider });
  const result = await contractLifecycle.sendEligibleReminders({
    emailProvider,
    recipient: config.contracts.notificationEmail,
  });
  logger.info('Contract reminder scan finished', result);
  if (result.failed) process.exitCode = 1;
} catch (error) {
  logger.error('Contract reminder scan failed', { error: error.code || 'contract_reminder_scan_failed' });
  process.exitCode = 1;
}
