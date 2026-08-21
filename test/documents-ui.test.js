import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionContracts,
  avatarInitials,
  contractDistribution,
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

test('CapLink app shell renders the sidebar, topbar, and reusable row components', () => {
  assert.equal(documentsPage.includes('class="app-shell" id="app-shell"'), true);
  assert.equal(documentsPage.includes('class="app-frame"'), true);
  assert.equal(documentsPage.includes('<nav class="sidebar" aria-label="Main">'), true);
  assert.equal(documentsPage.includes('class="topbar"'), true);
  assert.equal(documentsPage.includes('<strong>Contract Management</strong>'), true);
  assert.equal(documentsPage.includes('<span>Capital Infusion</span>'), true);
  assert.equal(documentsPage.includes('id="overview-panel"'), true);
  for (const component of ['function PageHeader', 'function Panel', 'function StatCard', 'function RepRow',
    'function AgreementRow', 'function DocumentRow', 'function EmptyState', 'function DetailsDisclosure',
    'function FilterPills', 'function TypeCard', 'function DonutRing', 'function renderOverviewPanel']) {
    assert.equal(documentsPage.includes(component), true, `missing ${component}`);
  }
});

test('sidebar navigation only links to routes and sections this app really has', () => {
  for (const href of ['href="/documents"', 'href="/documents#representatives"',
    'href="/documents#needs-attention"', 'href="/documents#upcoming-renewals"']) {
    assert.equal(documentsPage.includes(href), true, `missing ${href}`);
  }
  assert.equal(documentsPage.includes('id="nav-collapse"'), true);
  assert.equal(documentsPage.includes('id="nav-expand"'), true);
  assert.equal(documentsPage.includes('id="menu-toggle"'), false);
  for (const invented of ['Channels', 'Messages', 'Notifications', 'New contract', 'Invite', 'Presence']) {
    assert.equal(documentsPage.includes(invented), false, `invented feature ${invented}`);
  }
});

test('no representative, contract, or document values are hardcoded into the page', () => {
  for (const mock of ['Nathalia Nava', 'Adrian Luis', 'Bryan Castillo', 'Marcus Webb', 'Dana Kessler',
    'Sarah Fondeur', 'Gustavo', '294 KB', '337 KB', 'capital-infusion.com']) {
    assert.equal(documentsPage.includes(mock), false, `hardcoded value ${mock}`);
  }
  for (const source of ["api('/api/reps?sort=recent')", "api(endpoint)",
    "api('/api/docusign/envelopes/'+encodeURIComponent(envelopeId))"]) {
    assert.equal(documentsPage.includes(source), true, `missing live data source ${source}`);
  }
});

test('contract distribution derives every dashboard tile from live rep contracts', () => {
  const reps = [
    { name: 'A', contract: { currentTier: 1, currentContract: {}, contractType: 'W-2', daysRemaining: 183 } },
    { name: 'B', contract: { currentTier: 2, currentContract: {}, contractType: '1099', daysRemaining: 12 } },
    { name: 'C', contract: { currentTier: 3, currentContract: {}, contractType: 'W-2', daysRemaining: -4 } },
    { name: 'D' },
  ];
  assert.deepEqual(contractDistribution(reps), {
    tracked: 3,
    active: 2,
    healthy: 1,
    dueSoon: 1,
    expired: 1,
    'W-2': 2,
    1099: 1,
    tier1: 1,
    tier2: 1,
    tier3: 0,
  });
  assert.deepEqual(contractDistribution([]), {
    tracked: 0, active: 0, healthy: 0, dueSoon: 0, expired: 0, 'W-2': 0, 1099: 0, tier1: 0, tier2: 0, tier3: 0,
  });
});

test('the contract overview panel is built from live counts, not fixed figures', () => {
  for (const text of ['Contract Overview', 'contracts tracked', 'Total Active', 'Renewals Due',
    'Tier distribution', 'Independent contractors', 'Employed representatives']) {
    assert.equal(documentsPage.includes(text), true, `missing ${text}`);
  }
  assert.equal(documentsPage.includes("distribution.healthy,'#12b47a'"), true);
  assert.equal(documentsPage.includes("distribution.dueSoon,'#ffc629'"), true);
  assert.equal(documentsPage.includes("distribution.expired,'#ff6b6b'"), true);
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

test('dashboard includes All, W-2, and 1099 representative filters and contract type badges', () => {
  assert.equal(documentsPage.includes('data-contract-type='), true);
  assert.equal(documentsPage.includes('data-type-card='), true);
  assert.equal(documentsPage.includes("pill('all',distribution.tracked,'All contracts')"), true);
  assert.equal(documentsPage.includes("pill('W-2',distribution['W-2'],'W-2')"), true);
  assert.equal(documentsPage.includes("pill('1099',distribution['1099'],'1099')"), true);
  assert.equal(documentsPage.includes("TypeCard('W-2',initial.reps)"), true);
  assert.equal(documentsPage.includes("TypeCard('1099',initial.reps)"), true);
  assert.equal(documentsPage.includes("query.set('contractType',contractType)"), true);
  assert.equal(documentsPage.includes("StatusBadge(contract.contractType||'Unknown','contract')"), true);
  assert.equal(documentsPage.includes("['Contract Type',contract.contractType||'Unknown']"), true);
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
