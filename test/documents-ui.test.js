import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionContracts,
  avatarInitials,
  contractStatus,
  dashboardSummary,
  documentPresentation,
  documentsPage,
  formatFileSize,
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
    key: 'signed', badge: 'Signed Document', heading: 'Employment Agreement',
  });
  assert.deepEqual(documentPresentation('certificate'), {
    key: 'certificate', badge: 'Certificate', heading: 'DocuSign Certificate',
  });
  assert.equal(documentPresentation('supplemental').badge, 'Supplemental');
});

test('avatars and safe file sizes use compact CapLink row formatting', () => {
  assert.equal(avatarInitials('Sarah Fondeur'), 'SF');
  assert.equal(avatarInitials('Gustavo Prieto de Paula'), 'GP');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(132_096), '129 KB');
  assert.equal(formatFileSize(undefined), '');
});

test('dashboard and detail views include required human-facing sections and empty states', () => {
  for (const text of [
    'Contract Management',
    'Needs Attention',
    'Upcoming Renewals',
    'Representatives',
    'Contract Status',
    'Contract History',
    'Documents & Agreements',
    'Advanced Details',
    'No representatives found.',
    'No contracts currently require attention.',
    'No upcoming renewals.',
    'No completed documents for this representative.',
  ]) assert.equal(documentsPage.includes(text), true, `missing ${text}`);
});

test('CapLink app shell, simplified topbar, and reusable row components render', () => {
  assert.equal(documentsPage.includes('class="app-shell"'), true);
  assert.equal(documentsPage.includes('class="topbar"'), true);
  assert.equal(documentsPage.includes('<strong>Contract Management</strong>'), true);
  assert.equal(documentsPage.includes('<span>Capital Infusion</span>'), true);
  assert.equal(documentsPage.includes('class="sidebar"'), false);
  assert.equal(documentsPage.includes('id="menu-toggle"'), false);
  assert.equal(documentsPage.includes('Internal Operations'), false);
  assert.equal(documentsPage.includes('Company workspace'), false);
  assert.equal(documentsPage.includes('Internal operations workspace'), false);
  for (const component of ['function PageHeader', 'function Panel', 'function StatCard', 'function RepRow',
    'function AgreementRow', 'function DocumentRow', 'function EmptyState', 'function DetailsDisclosure']) {
    assert.equal(documentsPage.includes(component), true, `missing ${component}`);
  }
});

test('rep and agreement rows remain full keyboard-focusable links with clear affordances', () => {
  assert.equal(documentsPage.includes('function DataRow'), true);
  assert.equal(documentsPage.includes("ariaLabel:'View '"), true);
  assert.equal(documentsPage.includes("ariaLabel:'Open '"), true);
  assert.equal(documentsPage.includes('aria-hidden="true">›'), true);
  assert.equal(documentsPage.includes(':focus-visible'), true);
});

test('rep tabs have keyboard behavior and associated tab panels', () => {
  assert.equal(documentsPage.includes('role="tablist"'), true);
  assert.equal(documentsPage.includes('role="tab"'), true);
  assert.equal(documentsPage.includes('role="tabpanel"'), true);
  assert.equal(documentsPage.includes("event.key==='ArrowRight'"), true);
  assert.equal(documentsPage.includes("event.key==='ArrowLeft'"), true);
  assert.equal(documentsPage.includes("aria-selected"), true);
});

test('page includes accessible shell controls and meaningful document actions without storage keys', () => {
  assert.equal(documentsPage.includes('Skip to main content'), true);
  assert.equal(documentsPage.includes('<main class="content" id="main-content"'), true);
  assert.equal(documentsPage.includes('aria-label="Application navigation"'), false);
  assert.equal(documentsPage.includes("PrimaryButton('View PDF'"), true);
  assert.equal(documentsPage.includes("SecondaryButton('Download'"), true);
  assert.equal(documentsPage.includes('details-disclosure'), true);
  assert.equal(documentsPage.includes('objectKey'), false);
  assert.equal(documentsPage.includes('storedName'), false);
  assert.equal(documentsPage.includes('R2_'), false);
});
