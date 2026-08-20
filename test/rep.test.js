import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayNameFromEmail,
  isInternalRepEmail,
  normalizeEmail,
  resolveRepFromSender,
} from '../src/docusign/rep.js';

test('normalizes and validates internal rep emails centrally', () => {
  assert.equal(normalizeEmail(' John.Smith@Capital-Infusion.com '), 'john.smith@capital-infusion.com');
  assert.equal(isInternalRepEmail('john@capital-infusion.com'), true);
  assert.equal(isInternalRepEmail('customer@gmail.com'), false);
  assert.equal(isInternalRepEmail('not-an-email'), false);
});

test('prefers sender display name and falls back to the email username', () => {
  assert.deepEqual(resolveRepFromSender({
    email: 'JOHN.SMITH@capital-infusion.com',
    userName: 'Jonathan Smith',
  }), {
    repId: 'john.smith@capital-infusion.com',
    type: 'internal',
    email: 'john.smith@capital-infusion.com',
    name: 'Jonathan Smith',
  });
  assert.equal(displayNameFromEmail('mary_jane@capital-infusion.com'), 'Mary Jane');
  assert.equal(resolveRepFromSender({ email: 'mary_jane@capital-infusion.com' }).name, 'Mary Jane');
});

test('groups external or missing senders as unassigned instead of discarding them', () => {
  assert.deepEqual(resolveRepFromSender({ email: 'customer@gmail.com', name: 'Customer' }), {
    repId: 'unassigned',
    type: 'unassigned',
    email: 'customer@gmail.com',
    name: 'Unknown Rep',
  });
  assert.equal(resolveRepFromSender({}).repId, 'unassigned');
});
