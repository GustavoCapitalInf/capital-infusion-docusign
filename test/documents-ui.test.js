import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  AVATAR_STACK_LIMIT,
  DASHBOARD_PREVIEW_LIMIT,
  attentionContracts,
  avatarInitials,
  avatarStack,
  contractDistribution,
  contractStatus,
  dashboardPreviewReps,
  dashboardSummary,
  documentPresentation,
  documentsPage,
  formatFileSize,
  indicatorVisible,
  primaryAgreementName,
  trackedContractReps,
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
    'function FilterPills', 'function FolderCard', 'function FolderPopover', 'function initFolders',
    'function DonutRing', 'function renderOverviewPanel', 'function representativesPage']) {
    assert.equal(documentsPage.includes(component), true, `missing ${component}`);
  }
});

test('sidebar navigation points at real views and nothing else', () => {
  assert.equal(documentsPage.includes('href="/documents"'), true);
  assert.equal(documentsPage.includes('href="/representatives"'), true);
  assert.equal(documentsPage.includes('href="/documents#representatives"'), false);
  assert.equal(documentsPage.includes('href="/documents#needs-attention"'), false);
  assert.equal(documentsPage.includes('href="/documents#upcoming-renewals"'), false);
  for (const invented of ['Channels', 'Messages', 'Notifications', 'New contract', 'Invite', 'Presence']) {
    assert.equal(documentsPage.includes(invented), false, `invented feature ${invented}`);
  }
});

test('a single navigation toggle stays in the sidebar header in both states', () => {
  assert.equal(documentsPage.includes('id="nav-toggle"'), true);
  assert.equal(documentsPage.includes('id="nav-collapse"'), false);
  assert.equal(documentsPage.includes('id="nav-expand"'), false);
  const brand = documentsPage.slice(documentsPage.indexOf('<div class="brand">'), documentsPage.indexOf('</div>', documentsPage.indexOf('id="nav-toggle"')));
  assert.equal(brand.includes('id="nav-toggle"'), true, 'toggle must live in the sidebar header');
  assert.equal(documentsPage.includes('.app-shell.nav-collapsed #nav-toggle svg{transform:rotate(180deg)}'), true);
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
  assert.equal(documentsPage.includes("pill('all',distribution.tracked,'All contracts')"), true);
  assert.equal(documentsPage.includes("pill('W-2',distribution['W-2'],'W-2')"), true);
  assert.equal(documentsPage.includes("pill('1099',distribution['1099'],'1099')"), true);
  assert.equal(documentsPage.includes("FolderCard('W-2',initial.reps)"), true);
  assert.equal(documentsPage.includes("FolderCard('1099',initial.reps)"), true);
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

function loadClientScript() {
  const source = documentsPage.match(/<script>([\s\S]*)<\/script>/)[1];
  const stub = () => ({
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    tabIndex: 0,
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    addEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => stub(),
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
  });
  const context = {
    document: { querySelector: () => stub(), querySelectorAll: () => [], addEventListener() {} },
    location: { pathname: '/unrouted-for-tests', hash: '' },
    history: { replaceState() {} },
    window: { addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => ({ reps: [] }) }),
    requestAnimationFrame() {},
    URLSearchParams,
    Intl,
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function contractRep(name, contractType, tier, daysRemaining) {
  return {
    repId: `${name.replace(/\s+/g, '.').toLowerCase()}@example.test`,
    name,
    email: `${name.replace(/\s+/g, '.').toLowerCase()}@example.test`,
    completedEnvelopeCount: 1,
    contract: {
      currentTier: tier,
      currentContract: { envelopeId: `${name}-envelope` },
      contractType,
      daysRemaining,
      expiresAt: '2027-02-20T00:00:00.000Z',
    },
  };
}

const FOLDER_FIXTURE = [
  contractRep('Alpha One', '1099', 1, 183),
  contractRep('Beta Two', '1099', 1, 120),
  contractRep('Gamma Three', 'W-2', 2, 40),
  { repId: 'no.contract@example.test', name: 'No Contract', completedEnvelopeCount: 1 },
];

test('the client script evaluates standalone so render helpers can be exercised', () => {
  const client = loadClientScript();
  assert.equal(typeof client.FolderCard, 'function');
  assert.equal(typeof client.FolderPopover, 'function');
  assert.equal(typeof client.tierCards, 'function');
  assert.equal(typeof client.RepRow, 'function');
});

test('a folder card opens a popover listing only that contract type', () => {
  const { FolderCard } = loadClientScript();
  const html = FolderCard('1099', FOLDER_FIXTURE);
  assert.equal(html.includes('data-folder="1099"'), true);
  assert.equal(html.includes('aria-haspopup="dialog"'), true);
  assert.equal(html.includes('aria-controls="folder-popover-1099"'), true);
  assert.equal(html.includes('id="folder-popover-1099"'), true);
  assert.equal(html.includes('role="dialog"'), true);
  assert.equal(html.includes('Alpha One'), true);
  assert.equal(html.includes('Beta Two'), true);
  assert.equal(html.includes('Gamma Three'), false, 'W-2 rep must not appear in the 1099 folder');
  assert.equal(html.includes('No Contract'), false, 'untracked rep must not appear in a folder');
  assert.equal(html.includes('1099 Contracts'), true);
  assert.equal(html.includes('2 reps'), true);
});

test('folder popover rows link to the existing representative detail route', () => {
  const { FolderPopover } = loadClientScript();
  const html = FolderPopover('1099', trackedContractReps(FOLDER_FIXTURE, '1099'));
  assert.equal(html.includes('href="/documents/reps/alpha.one%40example.test"'), true);
  assert.equal(html.includes('href="/documents/reps/beta.two%40example.test"'), true);
  assert.equal(html.includes('Tier 1 · Active'), true);
  assert.equal(html.includes('Expires'), true);
});

test('an empty folder shows a real empty state and keeps the docked footer', () => {
  const { FolderCard } = loadClientScript();
  const html = FolderCard('W-2', [FOLDER_FIXTURE[0]]);
  assert.equal(html.includes('No representatives yet'), true);
  assert.equal(html.includes('0 reps'), true);
  assert.equal(html.includes('class="avatar-stack"'), false, 'no fake avatars in an empty folder');
  assert.equal(html.includes('class="folder-foot"'), true, 'footer stays docked when empty');
  assert.equal(html.includes('class="folder-chevron"'), true);
});

test('folder icons are filled black on the W-2 card and filled white on the 1099 card', () => {
  const { FolderCard } = loadClientScript();
  assert.equal(FolderCard('W-2', FOLDER_FIXTURE).includes('<svg viewBox="0 0 24 24" fill="#171a1f"'), true);
  assert.equal(FolderCard('1099', FOLDER_FIXTURE).includes('<svg viewBox="0 0 24 24" fill="#ffffff"'), true);
});

test('the avatar stack shows real representatives and collapses the remainder', () => {
  const reps = Array.from({ length: 7 }, (_, index) => contractRep(`Rep ${index}`, '1099', 1, 100));
  assert.equal(AVATAR_STACK_LIMIT, 3);
  assert.deepEqual(avatarStack(reps).shown.length, 3);
  assert.equal(avatarStack(reps).overflow, 4);
  assert.deepEqual(avatarStack([]), { shown: [], overflow: 0 });
  const { FolderCard } = loadClientScript();
  assert.equal(FolderCard('1099', reps).includes('>+4<'), true);
});

test('the dashboard preview renders at most five representatives in the given order', () => {
  const reps = Array.from({ length: 10 }, (_, index) => contractRep(`Rep ${index}`, '1099', 1, 100 + index));
  assert.equal(DASHBOARD_PREVIEW_LIMIT, 5);
  const preview = dashboardPreviewReps(reps);
  assert.equal(preview.length, 5);
  assert.deepEqual(preview.map((rep) => rep.name), ['Rep 0', 'Rep 1', 'Rep 2', 'Rep 3', 'Rep 4']);
  assert.equal(dashboardPreviewReps(reps.slice(0, 3)).length, 3);
  assert.deepEqual(dashboardPreviewReps([]), []);
  const sortedByName = [...reps].sort((a, b) => b.name.localeCompare(a.name));
  assert.deepEqual(dashboardPreviewReps(sortedByName).map((rep) => rep.name),
    ['Rep 9', 'Rep 8', 'Rep 7', 'Rep 6', 'Rep 5'], 'preview follows the sorted dataset');
  assert.equal(documentsPage.includes('renderRepResults(initial.reps,DASHBOARD_PREVIEW_LIMIT)'), true);
  assert.equal(documentsPage.includes('bindRepControls(DASHBOARD_PREVIEW_LIMIT)'), true);
});

test('the representatives page is a real route that renders the unlimited list', () => {
  assert.equal(documentsPage.includes("path==='/representatives'"), true);
  assert.equal(documentsPage.includes('return representativesPage()'), true);
  assert.equal(documentsPage.includes('renderRepResults(initial.reps);updateNavCounts(initial.reps);bindRepControls()'), true);
  assert.equal(documentsPage.includes('All Representatives'), true);
  assert.equal(documentsPage.includes('href="/representatives">View All Representatives'), true);
  assert.equal(documentsPage.includes("const shown=limit?dashboardPreviewReps(reps,limit):reps"), true);
});

test('tier and expired indicators appear only when the underlying count is above zero', () => {
  assert.equal(indicatorVisible(0), false);
  assert.equal(indicatorVisible(1), true);
  assert.equal(indicatorVisible(undefined), false);
  const { tierCards } = loadClientScript();
  const flags = (html) => html.split('class="stat-flag"').length - 1;
  const none = tierCards([{ repId: 'a@example.test', name: 'A', completedEnvelopeCount: 1 }]);
  assert.equal(flags(none), 0, 'no indicators when nothing is tracked');
  const tierOneOnly = tierCards([contractRep('Alpha One', '1099', 1, 183)]);
  assert.equal(flags(tierOneOnly), 1, 'only the populated tier shows an indicator');
  assert.equal(tierOneOnly.includes('tone-red'), true);
  const withExpired = tierCards([contractRep('Alpha One', '1099', 1, 183), contractRep('Beta Two', 'W-2', 2, -3)]);
  assert.equal(flags(withExpired), 2, 'tier 1 and expired both have live counts');
  const expiredPair = tierCards([contractRep('A', 'W-2', 3, -1), contractRep('B', 'W-2', 3, -9)]);
  assert.equal(flags(expiredPair), 1, 'expired shows an indicator, empty tiers do not');
});

test('the contract overview hides the expired chip when nothing has expired', () => {
  assert.equal(documentsPage.includes("indicatorVisible(summary.expired)?'<span class=\"overview-chip\">'"), true);
  assert.equal(documentsPage.includes('badge.hidden=!indicatorVisible(attention)'), true);
});

test('needs attention and upcoming renewals render above the tier and representative sections', () => {
  const dashboard = documentsPage.slice(documentsPage.indexOf('async function dashboardPage()'));
  const folders = dashboard.indexOf("FolderCard('W-2',initial.reps)");
  const panels = dashboard.indexOf('renewalPanels(initial.reps)');
  const tiers = dashboard.indexOf('tierCards(initial.reps)');
  const reps = dashboard.indexOf('<h2 class="section-title">Representatives</h2>');
  assert.equal(folders < panels, true, 'folder cards come first');
  assert.equal(panels < tiers, true, 'needs attention / renewals sit above the tier stats');
  assert.equal(tiers < reps, true, 'tier stats sit above the representative preview');
});

test('folder cards are keyboard operable and close on Escape or an outside click', () => {
  assert.equal(documentsPage.includes("card.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();toggle(card)})"), true);
  assert.equal(documentsPage.includes("if(!event.target.closest('.folder-anchor'))closeAll()"), true);
  assert.equal(documentsPage.includes("if(event.key!=='Escape')return"), true);
  assert.equal(documentsPage.includes('closeAll();open.focus()'), true);
  assert.equal(documentsPage.includes('focus({preventScroll:true})'), true);
});
