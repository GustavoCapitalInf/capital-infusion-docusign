import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEnvelopePolicy, knownLegacyDemoEnvelopes } from '../src/docusign/demo.js';

const known = [
  ['1a8d27b7-5eff-8640-80eb-1ca1738a1374', 'sarahfondeur5@gmail.com'],
  ['e277245f-e424-8683-8123-2d76be8e1384', 'sarahfondeur5@gmail.com'],
  ['3d7b2f01-f4b7-809f-8044-f78473831380', 'sarahfondeur5@gmail.com'],
  ['68e02c5c-a74c-8e80-81d6-cdde5f85139c', 'gustavoprietop@gmail.com'],
];

test('identifies the four confirmed legacy demo envelope IDs and reps', () => {
  assert.deepEqual(
    knownLegacyDemoEnvelopes().map(({ envelopeId, repId }) => [envelopeId, repId]),
    known,
  );
  const policy = createDemoEnvelopePolicy({ environment: 'production' });
  for (const [envelopeId, repId] of known) {
    assert.deepEqual(policy.classify({ envelopeId }), {
      kind: 'demo',
      reason: 'known_legacy_demo_envelope',
      envelopeId,
      repId,
    });
    assert.equal(policy.excludesEnvelope({ envelopeId }), true);
  }
});

test('does not hide demo records while the app itself runs against demo', () => {
  const policy = createDemoEnvelopePolicy({ environment: 'demo' });
  assert.equal(policy.excludesEnvelope({ envelopeId: known[0][0] }), false);
});

test('supports stored environment and configured account or envelope metadata signals', () => {
  const policy = createDemoEnvelopePolicy({
    environment: 'production',
    demoEnvelopeIds: new Set(['configured-envelope']),
    demoAccountIds: new Set(['demo-account']),
  });
  assert.equal(policy.classify({ envelopeId: 'stored-env', environment: 'demo' }).reason, 'stored_demo_environment');
  assert.equal(policy.classify({ envelopeId: 'stored-account', accountId: 'demo-account' }).reason, 'configured_demo_account');
  assert.equal(policy.classify({ envelopeId: 'configured-envelope' }).reason, 'configured_demo_envelope');
  assert.equal(policy.excludesEnvelope({ envelopeId: 'production-envelope' }), false);
});

test('excludes an all-demo lifecycle without deleting its underlying record', () => {
  const policy = createDemoEnvelopePolicy({ environment: 'production' });
  assert.equal(policy.excludesLifecycle({
    contracts: [{ envelopeId: known[0][0] }],
  }), true);
  assert.equal(policy.excludesLifecycle({
    contracts: [{ envelopeId: known[0][0] }, { envelopeId: 'production-envelope' }],
  }), false);
});
