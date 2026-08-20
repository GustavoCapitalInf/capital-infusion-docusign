import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayNameFromEmail,
  normalizeEmail,
  resolveRepFromRecipients,
} from '../src/docusign/rep.js';

test('normalizes signer email and derives a fallback display name', () => {
  assert.equal(normalizeEmail(' GustavoPrietoP@GMAIL.com '), 'gustavoprietop@gmail.com');
  assert.equal(normalizeEmail('not-an-email'), '');
  assert.equal(displayNameFromEmail('mary_jane@example.com'), 'Mary Jane');
});

test('resolves one completed signer as rep and never selects a CC', () => {
  const result = resolveRepFromRecipients({
    signers: [{ email: ' GustavoPrietoP@GMAIL.com ', name: 'Gustavo Prieto', status: 'completed' }],
    carbonCopies: [{ email: 'hr@capital-infusion.com', name: 'HR', status: 'completed' }],
  });
  assert.deepEqual(result, {
    rep: {
      repId: 'gustavoprietop@gmail.com',
      type: 'signer',
      email: 'gustavoprietop@gmail.com',
      name: 'Gustavo Prieto',
    },
    resolution: { status: 'resolved', completedSignerCount: 1 },
  });
});

test('deduplicates signer records by normalized email', () => {
  const result = resolveRepFromRecipients({ signers: [
    { email: 'rep@example.com', name: 'Rep', status: 'completed' },
    { email: 'REP@example.com', name: 'Rep', signedDateTime: '2026-08-20' },
  ] });
  assert.equal(result.rep.repId, 'rep@example.com');
  assert.equal(result.resolution.completedSignerCount, 1);
});

test('marks multiple distinct completed signers as requiring resolution', () => {
  const result = resolveRepFromRecipients({ signers: [
    { email: 'one@example.com', status: 'completed' },
    { email: 'two@example.com', status: 'completed' },
  ] });
  assert.equal(result.rep.repId, 'requires-resolution');
  assert.equal(result.rep.type, 'requires_resolution');
  assert.deepEqual(result.resolution, { status: 'requires_resolution', completedSignerCount: 2 });
});

test('leaves envelopes without a completed signer unassigned', () => {
  const result = resolveRepFromRecipients({
    signers: [{ email: 'pending@example.com', status: 'delivered' }],
    carbonCopies: [{ email: 'cc@example.com', status: 'completed' }],
  });
  assert.equal(result.rep.repId, 'unassigned');
  assert.equal(result.resolution.completedSignerCount, 0);
});
