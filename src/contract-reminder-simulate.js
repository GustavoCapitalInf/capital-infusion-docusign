import { loadConfig } from './config.js';
import { createStorageProvider } from './docusign/storage-provider.js';
import { createContractEmailProvider } from './contracts/email.js';
import { ContractReminderSimulation } from './contracts/reminder-simulation.js';

function parseArguments(args) {
  const options = { idempotencyTest: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--idempotency-test') {
      options.idempotencyTest = true;
    } else if (argument === '--rep') {
      options.repId = args[index += 1];
    } else if (argument === '--days') {
      const value = args[index += 1];
      options.daysRemaining = /^\d+$/.test(value || '') ? Number(value) : Number.NaN;
    } else {
      const error = new Error('Unknown contract reminder test argument');
      error.code = 'invalid_contract_reminder_test_argument';
      throw error;
    }
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const storage = createStorageProvider(config);
  const emailProvider = createContractEmailProvider({
    provider: config.contracts.emailProvider,
    powerAutomateUrl: config.contracts.powerAutomateUrl,
    from: config.contracts.emailFrom,
    resendApiKey: config.contracts.resendApiKey,
  });
  const simulation = new ContractReminderSimulation({
    storage,
    emailProvider,
    recipient: config.contracts.notificationEmail,
  });
  const result = await simulation.run(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    success: false,
    error: error.code || 'contract_reminder_test_failed',
  })}\n`);
  process.exitCode = 1;
}
