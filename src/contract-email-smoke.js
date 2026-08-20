import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createContractEmailProvider } from './contracts/email.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const emailProvider = createContractEmailProvider({
  provider: config.contracts.emailProvider,
  powerAutomateUrl: config.contracts.powerAutomateUrl,
  from: config.contracts.emailFrom,
  resendApiKey: config.contracts.resendApiKey,
});

try {
  emailProvider.assertConfigured(config.contracts.notificationEmail);
  const result = await emailProvider.sendContractReminder({
    notificationId: `provider-test-${Date.now()}`,
    to: config.contracts.notificationEmail,
    rep: {
      name: 'Example Representative',
      email: 'representative@example.com',
    },
    currentTier: 1,
    nextTier: 2,
    expiresAt: '2027-02-20T00:00:00.000Z',
    daysRemaining: 30,
  });
  logger.info('Contract email provider test succeeded', {
    provider: emailProvider.name,
    httpStatus: result.status,
  });
} catch (error) {
  logger.error('Contract email provider test failed', {
    provider: emailProvider.name,
    error: error.code || 'contract_email_test_failed',
  });
  process.exitCode = 1;
}
