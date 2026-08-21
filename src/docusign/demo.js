const LEGACY_DEMO_ENVELOPES = new Map([
  ['1a8d27b7-5eff-8640-80eb-1ca1738a1374', 'sarahfondeur5@gmail.com'],
  ['e277245f-e424-8683-8123-2d76be8e1384', 'sarahfondeur5@gmail.com'],
  ['3d7b2f01-f4b7-809f-8044-f78473831380', 'sarahfondeur5@gmail.com'],
  ['68e02c5c-a74c-8e80-81d6-cdde5f85139c', 'gustavoprietop@gmail.com'],
]);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function metadataEnvironment(metadata = {}) {
  return normalized(
    metadata.docusignEnvironment
    || metadata.accountEnvironment
    || metadata.environment
    || metadata.envelope?.docusignEnvironment
    || metadata.envelope?.accountEnvironment
    || metadata.envelope?.environment
    || metadata.account?.environment,
  );
}

function metadataAccountId(metadata = {}) {
  return String(
    metadata.docusignAccountId
    || metadata.accountId
    || metadata.envelope?.accountId
    || metadata.account?.accountId
    || '',
  ).trim();
}

export function knownLegacyDemoEnvelopes() {
  return [...LEGACY_DEMO_ENVELOPES].map(([envelopeId, repId]) => ({ envelopeId, repId }));
}

export function createDemoEnvelopePolicy(config = {}) {
  const environment = normalized(config.environment);
  const configuredEnvelopeIds = new Set(config.demoEnvelopeIds || []);
  const demoEnvelopeIds = new Set([...LEGACY_DEMO_ENVELOPES.keys(), ...configuredEnvelopeIds]);
  const demoAccountIds = new Set(config.demoAccountIds || []);
  const production = environment === 'production';

  function classify(metadata = {}) {
    const envelopeId = String(metadata.envelopeId || '').trim();
    const knownRepId = LEGACY_DEMO_ENVELOPES.get(envelopeId);
    if (knownRepId) {
      return { kind: 'demo', reason: 'known_legacy_demo_envelope', envelopeId, repId: knownRepId };
    }
    if (configuredEnvelopeIds.has(envelopeId)) {
      return { kind: 'demo', reason: 'configured_demo_envelope', envelopeId };
    }
    const storedEnvironment = metadataEnvironment(metadata);
    if (['demo', 'sandbox'].includes(storedEnvironment)) {
      return { kind: 'demo', reason: 'stored_demo_environment', envelopeId };
    }
    const accountId = metadataAccountId(metadata);
    if (accountId && demoAccountIds.has(accountId)) {
      return { kind: 'demo', reason: 'configured_demo_account', envelopeId };
    }
    return { kind: 'unknown', reason: 'no_demo_signal', envelopeId };
  }

  function excludesEnvelope(metadata) {
    return production && classify(metadata).kind === 'demo';
  }

  function excludesLifecycle(lifecycle = {}) {
    if (!production) return false;
    const envelopeIds = new Set([
      ...(lifecycle.contracts || []).map((contract) => contract.envelopeId),
      ...(lifecycle.contractResolutions || []).map((resolution) => resolution.envelopeId),
    ].filter(Boolean));
    return envelopeIds.size > 0 && [...envelopeIds].every((envelopeId) => demoEnvelopeIds.has(envelopeId));
  }

  return {
    environment,
    classify,
    excludesEnvelope,
    excludesLifecycle,
  };
}
