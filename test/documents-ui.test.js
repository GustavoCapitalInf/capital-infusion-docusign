import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionContracts,
  contractStatus,
  dashboardSummary,
  documentPresentation,
  documentsPage,
  primaryAgreementName,
  upcomingContracts,
} from '../src/documents-ui.js';

function rep(name, daysRemaining, tier = 1) {
  return {
    repId: `${name.toLowerCase()}@example.com`,
    name,
    contract: daysRemaining === undefined ? undefined : {
      currentTier: tier,
      currentContract: { envelopeId: `${name}-envelope` },
      daysRemaining,
      expiresAt: '2027-02-20T00:00:00.000Z',
    },
  };
}

test('dashboard summary counts only real active contract states', () => {
  assert.deepEqual(dashboardSummary([
    rep('Tier One', 184, 1),
    rep('Due Soon', 15, 2),
    rep('Expired', -2, 1),
    rep('No Contract'),
  ]), {
    activeReps: 2,
    tier1: 1,
    renewalsDueSoon: 1,
    expired: 1,
  });
});

test('needs-attention contracts are ordered by urgency', () => {
  const result = attentionContracts([
    rep('Thirty', 30),
    rep('Seven', 7),
    rep('Expired', -4),
    rep('Fifteen', 15),
    rep('Later', 31),
    rep('No Contract'),
  ]);
  assert.deepEqual(result.map((item) => item.name), ['Expired', 'Seven', 'Fifteen', 'Thirty']);
});

test('upcoming renewals include only the 31–90 day preview window', () => {
  const result = upcomingContracts([
    rep('Thirty', 30),
    rep('Thirty One', 31),
    rep('Sixty', 60),
    rep('Ninety', 90),
    rep('Ninety One', 91),
  ]);
  assert.deepEqual(result.map((item) => item.name), ['Thirty One', 'Sixty', 'Ninety']);
});

test('status system includes accessible text labels in addition to color classes', () => {
  assert.deepEqual(contractStatus(-1), { key: 'expired', label: 'Expired', detail: 'Renewal required' });
  assert.equal(contractStatus(7).label, 'Action Required');
  assert.equal(contractStatus(15).label, 'Renewal Soon');
  assert.equal(contractStatus(91).label, 'Active');
  for (const statusClass of ['status-active', 'status-renewal', 'status-action', 'status-expired', 'status-neutral']) {
    assert.equal(documentsPage.includes(statusClass), true);
  }
});

test('agreement title prefers the signed business document name', () => {
  assert.equal(primaryAgreementName({
    documents: [
      { classification: 'certificate', name: 'Summary.pdf' },
      { classification: 'signed_document', name: 'Capital Infusion - Sarah Fondeur.pdf' },
    ],
  }), 'Capital Infusion - Sarah Fondeur.pdf');
  assert.equal(primaryAgreementName({ documents: [] }), 'Completed Agreement');
});

test('signed documents, certificates, and supplemental files have distinct presentation', () => {
  assert.deepEqual(documentPresentation('signed_document'), {
    key: 'signed', badge: 'Signed Document', heading: 'Employment Contract',
  });
  assert.deepEqual(documentPresentation('certificate'), {
    key: 'certificate', badge: 'Certificate', heading: 'Completion Certificate',
  });
  assert.equal(documentPresentation('supplemental').badge, 'Supplemental');
});

test('dashboard and detail views include required human-facing sections and empty states', () => {
  for (const text of [
    'Rep Contract Management',
    'Needs Attention',
    'Upcoming Renewals',
    'All Representatives',
    'Contract Status',
    'Contract History',
    'Documents &amp; Agreements',
    'Advanced Details',
    'No reps found.',
    'No contracts currently require action.',
    'No upcoming renewals.',
    'No completed documents for this rep.',
  ]) assert.equal(documentsPage.includes(text), true, `missing ${text}`);
});

test('rep and agreement rows are full keyboard-focusable links with clear affordances', () => {
  assert.equal(documentsPage.includes('class="card card-link rep-card"'), true);
  assert.equal(documentsPage.includes('class="card card-link agreement-card"'), true);
  assert.equal(documentsPage.includes('aria-label="View '), true);
  assert.equal(documentsPage.includes('aria-label="Open '), true);
  assert.equal(documentsPage.includes('aria-hidden="true">›'), true);
  assert.equal(documentsPage.includes(':focus-visible'), true);
});

test('page includes accessibility landmarks and meaningful document actions without storage keys', () => {
  assert.equal(documentsPage.includes('Skip to main content'), true);
  assert.equal(documentsPage.includes('aria-labelledby='), true);
  assert.equal(documentsPage.includes('aria-label="View '+"'"), true);
  assert.equal(documentsPage.includes('aria-label="Download '+"'"), true);
  assert.equal(documentsPage.includes('objectKey'), false);
  assert.equal(documentsPage.includes('R2_'), false);
});
