export function dashboardSummary(reps = []) {
  const tracked = reps.filter((rep) => rep.contract?.currentContract && rep.contract?.currentTier);
  const active = tracked.filter((rep) => rep.contract.daysRemaining > 0);
  return {
    activeReps: active.length,
    tier1: active.filter((rep) => rep.contract.currentTier === 1).length,
    renewalsDueSoon: active.filter((rep) => rep.contract.daysRemaining <= 30).length,
    expired: tracked.filter((rep) => rep.contract.daysRemaining <= 0).length,
  };
}

export function trackedContractReps(reps = [], contractType) {
  const tracked = reps.filter((rep) => rep.contract?.currentContract && rep.contract?.currentTier);
  return contractType ? tracked.filter((rep) => rep.contract.contractType === contractType) : tracked;
}

export function contractDistribution(reps = []) {
  const tracked = trackedContractReps(reps);
  const active = tracked.filter((rep) => rep.contract.daysRemaining > 0);
  const tier = (value) => active.filter((rep) => rep.contract.currentTier === value).length;
  return {
    tracked: tracked.length,
    active: active.length,
    healthy: active.filter((rep) => rep.contract.daysRemaining > 30).length,
    dueSoon: active.filter((rep) => rep.contract.daysRemaining <= 30).length,
    expired: tracked.length - active.length,
    'W-2': trackedContractReps(reps, 'W-2').length,
    1099: trackedContractReps(reps, '1099').length,
    tier1: tier(1),
    tier2: tier(2),
    tier3: tier(3),
  };
}

export const DASHBOARD_PREVIEW_LIMIT = 5;

export function dashboardPreviewReps(reps = [], limit = DASHBOARD_PREVIEW_LIMIT) {
  return reps.slice(0, Math.max(0, limit));
}

export const AVATAR_STACK_LIMIT = 3;

export function avatarStack(reps = [], limit = AVATAR_STACK_LIMIT) {
  const shown = reps.slice(0, Math.max(0, limit));
  return { shown, overflow: Math.max(0, reps.length - shown.length) };
}

export function indicatorVisible(count) {
  return Number(count) > 0;
}

export function attentionContracts(reps = []) {
  return reps
    .filter((rep) => rep.contract?.currentContract && rep.contract.daysRemaining <= 30)
    .sort((a, b) => a.contract.daysRemaining - b.contract.daysRemaining
      || String(a.name || '').localeCompare(String(b.name || '')));
}

export function upcomingContracts(reps = []) {
  return reps
    .filter((rep) => rep.contract?.currentContract
      && rep.contract.daysRemaining >= 31
      && rep.contract.daysRemaining <= 90)
    .sort((a, b) => a.contract.daysRemaining - b.contract.daysRemaining
      || String(a.name || '').localeCompare(String(b.name || '')));
}

export function contractStatus(daysRemaining) {
  if (daysRemaining <= 0) return { key: 'expired', label: 'Expired', detail: 'Renewal required' };
  if (daysRemaining <= 7) return { key: 'action', label: 'Action Required', detail: 'Renewal is urgent' };
  if (daysRemaining <= 30) return { key: 'renewal', label: 'Renewal Soon', detail: 'Renewal is approaching' };
  return { key: 'active', label: 'Active', detail: 'Contract is current' };
}

export function primaryAgreementName(envelope = {}) {
  return envelope.primaryDocumentName
    || envelope.documents?.find((document) => document.classification === 'signed_document')?.name
    || envelope.documents?.[0]?.name
    || 'Completed Agreement';
}

export function documentPresentation(classification) {
  if (classification === 'signed_document') {
    return { key: 'signed', badge: 'Signed Document', heading: 'Employment Agreement' };
  }
  if (classification === 'certificate') {
    return { key: 'certificate', badge: 'Certificate', heading: 'DocuSign Certificate' };
  }
  return { key: 'supplemental', badge: 'Supplemental', heading: 'Supplemental File' };
}

export function avatarInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'CI';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] : ''}`.toUpperCase();
}

export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export const documentsPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#e6e9ee">
  <title>Contract Management · Capital Infusion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{color-scheme:light;--ink:#171a1f;--muted:#7b818f;--faint:#9aa0ac;--line:#f0f1f5;--line-strong:#eceef2;--paper:#fff;--canvas:#e6e9ee;--soft:#fafbfc;--neutral:#f4f5f8;--neutral-ink:#3d434f;--blue:#2f6bff;--blue-soft:#eef4ff;--green:#0f8f5f;--green-soft:#e9f8f1;--amber:#96700a;--amber-soft:#fff8e3;--orange:#d1620f;--orange-soft:#fff1e8;--red:#e4574e;--red-soft:#ffeeed;--brand:#0f3d2e;--panel:#1c2033;--panel-inner:#232840;--panel-muted:#9aa2bd;--shadow-sm:0 1px 2px rgb(23 26 31/.04);--shadow-md:0 10px 24px rgb(23 26 31/.10);--nav-width:246px;--nav-rail:86px}
    *{box-sizing:border-box}html{scroll-behavior:smooth}
    body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 "Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    button,input,select{font:inherit}[hidden]{display:none!important}a{color:inherit;text-decoration:none}
    ::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#d6dae2;border-radius:8px}
    .skip-link{position:fixed;left:16px;top:-64px;z-index:100;background:var(--brand);color:#fff;padding:10px 14px;border-radius:10px;font-weight:700}.skip-link:focus{top:12px}
    .app-shell{display:flex;min-height:100vh;padding:20px}
    .app-frame{flex:1;display:flex;min-width:0;min-height:calc(100vh - 40px);background:var(--paper);border-radius:26px;overflow:hidden;box-shadow:0 20px 60px rgb(23 26 31/.10)}
    .sidebar{flex:none;width:var(--nav-width);display:flex;flex-direction:column;gap:6px;padding:20px 14px 18px;border-right:1px solid var(--line);overflow:hidden;white-space:nowrap;transition:width .22s cubic-bezier(.4,0,.2,1)}
    .brand{display:flex;align-items:center;gap:8px;height:44px;padding-left:5px;margin-bottom:14px}
    .brand-mark{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--brand);color:#fff;font-size:12px;font-weight:800;letter-spacing:.02em}
    .brand-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:15px;font-weight:800;letter-spacing:-.02em}
    #nav-toggle{flex:none;display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:8px;background:var(--neutral);color:var(--muted);cursor:pointer}
    #nav-toggle:hover{background:var(--line-strong);color:var(--ink)}
    #nav-toggle svg{transition:transform .22s cubic-bezier(.4,0,.2,1)}
    .nav-section{padding:0 6px 6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a1a7b3}
    .nav-item{display:flex;align-items:center;gap:13px;height:46px;padding:0 12px;border-radius:13px;color:var(--muted);font-size:13.5px;font-weight:600;white-space:nowrap}
    .nav-item:hover{background:#f6f7f9}
    .nav-item svg{flex:none;width:20px;height:20px}
    .nav-item[aria-current="page"]{background:var(--amber-soft);color:#8a6a00}
    .nav-count{margin-left:auto;display:grid;place-items:center;min-width:24px;height:22px;padding:0 7px;border-radius:999px;background:#ff5f57;color:#fff;font-size:11px;font-weight:700}
    .app-shell.nav-collapsed .sidebar{width:var(--nav-rail);padding-left:10px;padding-right:10px}
    .app-shell.nav-collapsed .nav-text,.app-shell.nav-collapsed .nav-count,.app-shell.nav-collapsed .nav-section,.app-shell.nav-collapsed .brand-name{display:none}
    .app-shell.nav-collapsed .brand{gap:6px;padding-left:0}
    .app-shell.nav-collapsed #nav-toggle svg{transform:rotate(180deg)}
    .app-shell.nav-collapsed .nav-item{justify-content:center;padding:0}
    .app-main{flex:1;min-width:0;display:flex;flex-direction:column}
    .topbar{flex:none;display:flex;align-items:center;gap:18px;height:74px;padding:0 26px;border-bottom:1px solid var(--line)}
    .topbar-search{flex:1;display:flex;justify-content:center}
    .topbar-context{margin-left:auto;display:flex;align-items:center;gap:9px;padding:5px 13px 5px 5px;border:1px solid var(--line);border-radius:999px}
    .topbar-context strong{font-size:12.5px;font-weight:700}
    .topbar-context span:not(.topbar-mark):not(.topbar-divider){color:var(--muted);font-size:12px}
    .topbar-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--brand);color:#fff;font-size:11px;font-weight:700}
    .topbar-divider{width:1px;height:14px;background:var(--line-strong)}
    .icon-button{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--line-strong);border-radius:11px;background:var(--paper);color:#8b919d;cursor:pointer}
    .icon-button:hover{background:#f6f7f9;color:var(--ink)}.icon-button svg{width:17px;height:17px}
    .workspace{flex:1;display:flex;min-height:0}
    .content{flex:1;min-width:0;padding:24px 26px 44px;overflow-y:auto}
    .page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap}
    .page-header>div{min-width:0}
    .page-title{margin:0;font-size:26px;font-weight:800;letter-spacing:-.03em;overflow-wrap:anywhere}
    .page-description{margin:8px 0 0;max-width:660px;color:var(--muted);font-size:13.5px}
    .page-title-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .active-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 6px;border-radius:999px;background:var(--green-soft);color:var(--green);font-size:12px;font-weight:700}
    .active-pill-mark{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#12b47a;color:#fff}
    .active-pill-mark svg{width:12px;height:12px}
    .breadcrumbs{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--faint);font-size:12px;overflow-wrap:anywhere}
    .breadcrumbs a{font-weight:700;color:var(--blue)}.breadcrumbs a:hover{text-decoration:underline}
    .profile-title{display:flex;align-items:center;gap:18px;margin-top:16px}
    .avatar{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--blue-soft);color:var(--blue);font-size:13px;font-weight:800}
    .avatar.large{width:64px;height:64px;border-radius:20px;font-size:19px}
    .avatar.small{width:36px;height:36px;border-radius:12px;font-size:11.5px}
    .profile-name{margin:0;font-size:25px;font-weight:800;letter-spacing:-.03em}
    .profile-email{margin-top:4px;color:var(--faint);font-size:13px}
    .profile-badges{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
    .filter-pills{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}
    .pill{height:34px;padding:0 15px;border:1px solid var(--line-strong);border-radius:999px;background:var(--paper);color:var(--neutral-ink);font-size:12.5px;white-space:nowrap;cursor:pointer}
    .pill:hover{background:#f6f7f9}
    .pill strong{font-weight:700}.pill span{opacity:.62}
    .pill[aria-selected="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
    .pill.static{display:inline-flex;align-items:center;cursor:default}
    .folder-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;margin-top:16px}
    .folder-anchor{position:relative;display:flex}
    .folder{display:flex;flex-direction:column;width:100%;padding:0;border:0;border-radius:20px;overflow:hidden;text-align:left;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease}
    .folder:hover{transform:translateY(-1px)}
    .folder-top{flex:1;display:flex;align-items:center;gap:12px;min-height:82px;padding:20px}
    .folder-foot{flex:none;display:flex;align-items:center;gap:11px;height:60px;padding:0 20px}
    .folder-foot svg{flex:none;width:22px;height:22px}
    .folder-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:19px;font-weight:800;letter-spacing:-.02em}
    .folder-count{flex:none;padding:5px 12px;border-radius:999px;background:#fff;font-size:12px;font-weight:700}
    .folder-chevron{flex:none;display:grid;place-items:center;width:30px;height:30px;margin-left:auto;border-radius:10px}
    .folder-chevron svg{width:15px;height:15px}
    .avatar-stack{display:flex}
    .avatar-stack .avatar,.avatar-stack .stack-more{width:38px;height:38px;border-radius:50%;font-size:11px}
    .avatar-stack>*+*{margin-left:-13px}
    .stack-more{display:grid;place-items:center;font-weight:800}
    .folder-empty{font-size:12.5px;font-weight:600;opacity:.8}
    .popover{position:absolute;z-index:40;top:calc(100% + 10px);left:0;right:0;max-height:340px;padding:8px;overflow-y:auto;background:var(--paper);border:1px solid var(--line);border-radius:20px;box-shadow:0 18px 44px rgb(23 26 31/.18)}
    .popover:focus{outline:none}
    .popover-title{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px 8px;font-size:13px;font-weight:800}
    .popover-title span{color:var(--faint);font-size:11.5px;font-weight:700}
    .popover-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px}
    .popover-row:hover{background:var(--soft)}
    .popover-copy{flex:1;min-width:0}
    .popover-name{display:block;font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .popover-meta{display:block;margin-top:2px;color:var(--faint);font-size:11.5px}
    .popover-empty{padding:12px 12px 16px;color:var(--faint);font-size:13px}
    .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:14px;margin-top:16px}
    .stat-card{padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:var(--shadow-sm)}
    .stat-card:hover{box-shadow:0 8px 22px rgb(23 26 31/.09)}
    .stat-card-top{display:flex;align-items:flex-start;justify-content:space-between;min-height:34px}
    .stat-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--blue-soft);color:var(--blue)}
    .stat-icon svg{width:17px;height:17px}
    .stat-card.tone-green .stat-icon{background:var(--green-soft);color:var(--green)}
    .stat-card.tone-violet .stat-icon{background:#f4f0ff;color:#6b4ff0}
    .stat-card.tone-red .stat-icon{background:var(--red-soft);color:var(--red)}
    .stat-flag{width:7px;height:7px;border-radius:50%;background:#2f8bff}
    .stat-card.tone-green .stat-flag{background:#12b47a}
    .stat-card.tone-violet .stat-flag{background:#7b61ff}
    .stat-card.tone-red .stat-flag{background:#ff5f57}
    .stat-label{margin-top:22px;font-size:14px;font-weight:700}
    .stat-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:5px}
    .stat-note{color:var(--faint);font-size:12px}
    .stat-card.tone-red .stat-note{color:var(--red)}
    .stat-value{font-size:15px;font-weight:800}
    .section-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:26px 0 14px}
    .section-title{margin:0;font-size:17px;font-weight:800;letter-spacing:-.02em}
    .section-description{margin:3px 0 0;color:var(--faint);font-size:12px}
    .section-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .link-action{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 15px;border:1px solid var(--line-strong);border-radius:999px;background:var(--paper);color:var(--neutral-ink);font-size:12.5px;font-weight:700;white-space:nowrap}
    .link-action:hover{background:#f6f7f9}
    .link-action svg{width:15px;height:15px}
    .toolbar{display:flex;gap:9px;flex-wrap:wrap}
    .field{position:relative;display:flex;align-items:center}
    .field.search{flex:1;min-width:0;max-width:420px}
    .field-icon{position:absolute;left:16px;display:grid;place-items:center;width:17px;height:17px;color:#a1a7b3;pointer-events:none}
    .field-icon svg{width:17px;height:17px}
    input.control{width:100%;height:44px;padding:0 18px 0 42px;border:1px solid var(--line-strong);border-radius:999px;background:var(--soft);color:var(--ink);font-size:13.5px;outline:none}
    input.control:focus{border-color:#c9cfda;background:var(--paper);box-shadow:0 0 0 4px rgb(47 107 255/.08)}
    select.control{height:34px;min-width:170px;padding:0 30px 0 14px;border:1px solid var(--line-strong);border-radius:999px;background:var(--paper);color:var(--neutral-ink);font-size:12.5px;font-weight:700;outline:none;cursor:pointer}
    select.control:hover{background:#f6f7f9}
    select.control:focus{border-color:#c9cfda;box-shadow:0 0 0 4px rgb(47 107 255/.08)}
    .data-list{display:flex;flex-direction:column;gap:11px}
    .data-row{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;width:100%;padding:15px 18px;border:1px solid var(--line);border-radius:18px;background:var(--paper);text-align:left;transition:box-shadow .16s ease,transform .16s ease}
    a.data-row:hover{box-shadow:var(--shadow-md);transform:translateY(-1px)}
    .data-row-main{display:flex;align-items:center;gap:13px;flex:1 1 210px;min-width:0}
    .data-row-copy{min-width:0}
    .data-row-title{font-size:14px;font-weight:700;overflow-wrap:anywhere}
    .data-row-subtitle{margin-top:3px;color:var(--faint);font-size:12.5px;overflow-wrap:anywhere}
    .data-row-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .data-row-tail{display:flex;flex-direction:column;align-items:flex-end;gap:3px;margin-left:auto;text-align:right;white-space:nowrap}
    .data-row-tail strong{font-size:12.5px;font-weight:700}
    .data-row-tail span{color:var(--faint);font-size:11.5px}
    .chevron{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#f6f7f9;color:#5c6270;font-size:17px;line-height:1}
    .panel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin-top:16px}
    .panel{border:1px solid var(--line);border-radius:20px;background:var(--paper);overflow:hidden}
    .panel+.panel{margin-top:16px}.panel.spaced{margin-top:22px}
    .tab-panel>.data-list,.tab-panel>.empty-state{margin-top:18px}
    .panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:17px 19px;border-bottom:1px solid #f5f6f9}
    .panel-title{margin:0;font-size:14.5px;font-weight:800}
    .panel-description{margin:3px 0 0;color:var(--faint);font-size:11.5px}
    .panel-count{flex:none;padding:4px 10px;border-radius:999px;background:var(--neutral);color:#5c6270;font-size:11.5px;font-weight:700}
    .panel-count.is-urgent{background:var(--red-soft);color:var(--red)}
    .panel-body.padded{padding:16px 18px}
    .attention-list{display:flex;flex-direction:column}
    .attention-row{display:flex;align-items:center;gap:13px;padding:14px 19px;border-top:1px solid #f5f6f9;background:var(--paper)}
    .attention-row:hover{background:var(--soft)}
    .urgency-bar{flex:none;width:3px;align-self:stretch;border-radius:4px;background:var(--orange)}
    .attention-row.is-urgent .urgency-bar{background:var(--red)}
    .attention-copy{display:block;flex:1;min-width:0}
    .attention-name{display:block;font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .attention-meta{display:block;margin-top:2px;color:var(--faint);font-size:11.5px}
    .attention-time{flex:none;display:flex;align-items:center;gap:9px;font-size:12px;font-weight:700;color:var(--orange)}
    .attention-row.is-urgent .attention-time{color:var(--red)}
    .attention-row.is-upcoming .attention-time{color:#5c6270}
    .status-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;line-height:1.4;white-space:nowrap}
    .status-badge.dotted:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
    .status-active{background:var(--green-soft);color:var(--green)}
    .status-renewal{background:var(--amber-soft);color:var(--amber)}
    .status-action{background:var(--orange-soft);color:var(--orange)}
    .status-expired{background:var(--red-soft);color:var(--red)}
    .status-neutral{background:var(--neutral);color:#5c6270}
    .status-contract{background:var(--neutral);color:var(--neutral-ink)}
    .status-tier{background:var(--blue-soft);color:var(--blue)}
    .status-signed{background:var(--green-soft);color:var(--green)}
    .status-certificate{background:var(--amber-soft);color:var(--amber)}
    .status-supplemental{background:var(--neutral);color:#5c6270}
    .tabs{display:inline-flex;gap:4px;max-width:100%;margin-top:24px;padding:4px;border-radius:999px;background:var(--neutral);overflow-x:auto}
    .tab{height:36px;padding:0 18px;border:0;border-radius:999px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:700;white-space:nowrap;cursor:pointer}
    .tab:hover{color:var(--ink)}
    .tab[aria-selected="true"]{background:var(--paper);color:var(--ink);box-shadow:0 1px 3px rgb(23 26 31/.12)}
    .tab-panel:focus{outline:none}
    .contract-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:14px;margin-top:18px}
    .contract-stat{padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--paper)}
    .contract-stat-label{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a1a7b3}
    .contract-stat-value{margin-top:9px;font-size:19px;font-weight:800;overflow-wrap:anywhere}
    .contract-status{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-top:14px;padding:18px 20px;border-radius:20px;background:var(--green-soft);color:var(--green)}
    .contract-status.status-renewal{background:var(--amber-soft);color:var(--amber)}
    .contract-status.status-action{background:var(--orange-soft);color:var(--orange)}
    .contract-status.status-expired{background:var(--red-soft);color:var(--red)}
    .contract-status strong{font-size:14px}
    .contract-status-copy{margin-top:3px;font-size:12.5px;opacity:.8}
    .contract-status-tail{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .contract-status-chip{padding:6px 13px;border-radius:999px;background:#fff;font-size:12px;font-weight:700;color:inherit}
    .contract-status-remaining{font-size:12.5px;font-weight:700}
    .file-mark{flex:none;display:grid;place-items:center;width:42px;height:48px;border:1px solid var(--line-strong);border-radius:12px;background:var(--soft);color:var(--red);font-size:9.5px;font-weight:800}
    .document-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;color:var(--faint);font-size:11.5px}
    .document-actions{display:flex;gap:9px;margin-left:auto;flex-wrap:wrap}
    .button{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 15px;border:1px solid var(--line-strong);border-radius:999px;background:var(--paper);color:var(--neutral-ink);font-size:12.5px;font-weight:700;white-space:nowrap}
    .button:hover{background:#f6f7f9}
    .button.primary{border-color:var(--ink);background:var(--ink);color:#fff}
    .button.primary:hover{background:#2f333c}
    .empty-state{display:flex;align-items:center;gap:12px;padding:24px;color:var(--faint);font-size:13.5px}
    .empty-state.dashed{border:1px dashed #e3e6ec;border-radius:18px}
    .empty-icon{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:var(--neutral);color:var(--faint)}
    .empty-icon svg{width:17px;height:17px}
    .error{margin-top:16px;padding:18px;border:1px solid #f4c9c6;border-radius:18px;background:var(--red-soft);color:var(--red);font-weight:600}
    .details-disclosure{margin-top:18px;border:1px solid var(--line);border-radius:18px;background:var(--paper);overflow:hidden}
    .details-disclosure summary{display:flex;align-items:center;gap:8px;padding:15px 18px;color:#5c6270;font-size:12.5px;font-weight:700;cursor:pointer;list-style:none}
    .details-disclosure summary::-webkit-details-marker{display:none}
    .details-disclosure summary:before{content:"›";font-size:17px;line-height:1;transition:transform .15s ease}
    .details-disclosure[open] summary:before{transform:rotate(90deg)}
    .metadata-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:16px;margin:0;padding:0 18px 18px}
    .metadata-label{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#a1a7b3}
    .metadata-value{margin:4px 0 0;font-size:12.5px;font-weight:600;color:var(--neutral-ink);overflow-wrap:anywhere}
    .metadata-value.technical{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#a1a7b3}
    .overview-panel{flex:none;width:312px;padding:22px;display:flex;flex-direction:column;gap:18px;background:var(--panel);color:#fff;overflow-y:auto}
    .overview-head{display:flex;align-items:center;gap:10px}
    .overview-head h2{margin:0;font-size:16px;font-weight:800;letter-spacing:-.02em}
    .overview-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:rgb(255 95 87/.16);color:#ff8f88;font-size:11px;font-weight:700}
    .donut{position:relative;display:grid;place-items:center;padding:14px 0 4px}
    .donut svg{transform:rotate(-90deg)}
    .donut-center{position:absolute;text-align:center}
    .donut-value{font-size:44px;font-weight:800;letter-spacing:-.04em;line-height:1}
    .donut-label{margin-top:2px;font-size:12px;color:var(--panel-muted)}
    .overview-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .overview-tile{padding:13px 14px;border-radius:15px;background:rgb(255 255 255/.06)}
    .overview-tile-label{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--panel-muted)}
    .overview-tile-value{margin-top:6px;font-size:22px;font-weight:800}
    .overview-block{padding:16px;border-radius:18px;background:var(--panel-inner);display:flex;flex-direction:column;gap:14px}
    .overview-line{display:flex;align-items:center;gap:12px}
    .overview-line-icon{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:12px}
    .overview-line-icon svg{width:17px;height:17px}
    .overview-line-copy{flex:1;min-width:0}
    .overview-line-copy strong{display:block;font-size:13px;font-weight:700}
    .overview-line-copy span{display:block;font-size:11px;color:var(--panel-muted)}
    .overview-line-value{padding:5px 11px;border-radius:999px;background:rgb(255 255 255/.09);font-size:11.5px;font-weight:700}
    .overview-legend{padding:16px;border-radius:18px;background:rgb(255 255 255/.06)}
    .overview-legend-title{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--panel-muted)}
    .overview-legend-list{display:flex;flex-direction:column;gap:11px;margin-top:12px}
    .overview-legend-row{display:flex;align-items:center;gap:10px;font-size:12.5px}
    .overview-legend-row span:first-child{flex:none;width:8px;height:8px;border-radius:50%}
    .overview-legend-row span:nth-child(2){flex:1}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #2f6bff;outline-offset:2px}
    @media(max-width:1180px){.overview-panel{display:none}}
    @media(max-width:960px){.sidebar{width:var(--nav-rail);padding-left:10px;padding-right:10px}.nav-text,.nav-count,.nav-section,.brand-name{display:none}.brand{gap:6px;padding-left:0}.nav-item{justify-content:center;padding:0}}
    @media(max-width:820px){.app-shell{padding:10px}.app-frame{min-height:calc(100vh - 20px);border-radius:20px}.topbar{gap:12px;padding:0 16px}.content{padding:20px 16px 36px}.topbar-context strong,.topbar-context .topbar-divider,.topbar-context span:not(.topbar-mark){display:none}.topbar-context{padding:4px;border:0}}
    @media(max-width:620px){.page-title{font-size:23px}.profile-title{align-items:flex-start}.avatar.large{width:52px;height:52px;border-radius:16px;font-size:16px}.profile-name{font-size:21px}.data-row-tail{align-items:flex-start;margin-left:0;text-align:left;width:100%}.document-actions{width:100%;margin-left:0}.button{flex:1}.field.search{max-width:none}.tabs{width:100%}.attention-row{flex-wrap:wrap}.attention-time{flex-wrap:wrap;width:100%;padding-left:49px;justify-content:flex-start}.popover{position:fixed;left:10px;right:10px;bottom:10px;top:auto;max-height:66vh;border-radius:22px}}
    @media(max-width:480px){.sidebar{width:78px;padding:16px 8px}.folder-grid,.stat-grid,.contract-stats{grid-template-columns:1fr}.chevron{display:none}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <div class="app-shell" id="app-shell">
    <div class="app-frame">
      <nav class="sidebar" aria-label="Main">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">CI</span>
          <span class="brand-name">Capital Infusion</span>
          <button id="nav-toggle" type="button" aria-label="Collapse navigation" aria-controls="app-shell" aria-expanded="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg></button>
        </div>
        <div class="nav-section">Menu</div>
        <a class="nav-item" id="nav-dashboard" href="/documents"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-2.2 5L8 16l2.2-5z"/></svg><span class="nav-text">Dashboard</span><span class="nav-count" id="nav-attention-count" hidden>0</span></a>
        <a class="nav-item" id="nav-reps" href="/representatives"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6"/><path d="M16.5 6.6a3 3 0 010 5.4M18 19c0-1.9-.6-3.3-1.8-4.2"/></svg><span class="nav-text">Representatives</span></a>
      </nav>
      <div class="app-main">
        <header class="topbar">
          <a class="icon-button" id="back-button" href="/documents" aria-label="Back to dashboard" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 6l-6 6 6 6"/><path d="M5 12h14"/></svg></a>
          <div class="topbar-search" id="topbar-search" hidden>
            <label class="sr-only" for="rep-search">Search representatives by name or email</label>
            <div class="field search"><span class="field-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></span><input class="control" id="rep-search" type="search" placeholder="Search representatives..."></div>
          </div>
          <div class="topbar-context"><span class="topbar-mark" aria-hidden="true">CI</span><strong>Contract Management</strong><span class="topbar-divider" aria-hidden="true"></span><span>Capital Infusion</span></div>
        </header>
        <div class="workspace">
          <main class="content" id="main-content" tabindex="-1"><div id="app"><div class="empty-state" role="status">Loading contract workspace…</div></div></main>
          <aside class="overview-panel" id="overview-panel" aria-label="Contract overview" hidden></aside>
        </div>
      </div>
    </div>
  </div>
<script>
${dashboardSummary}
${trackedContractReps}
${contractDistribution}
${dashboardPreviewReps}
${avatarStack}
${indicatorVisible}
${attentionContracts}
${upcomingContracts}
${contractStatus}
${primaryAgreementName}
${documentPresentation}
${avatarInitials}
${formatFileSize}
const DASHBOARD_PREVIEW_LIMIT=${DASHBOARD_PREVIEW_LIMIT};
const AVATAR_STACK_LIMIT=${AVATAR_STACK_LIMIT};
const app=document.querySelector('#app');
const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Unknown';
const dateOnly=value=>value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value)):'Unknown';
const plural=(count,word)=>count+' '+word+(count===1?'':'s');
const folderKey=type=>String(type).toLowerCase().replace(/[^a-z0-9]+/g,'-');
async function api(path){const response=await fetch(path);const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');return body}
function Icon(name){const paths={chart:'<path d="M4 19h4v-7H4zM10 19h4V6h-4zM16 19h4v-4h-4z"/>',alert:'<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',refresh:'<path d="M20 12a8 8 0 11-2.4-5.7"/><path d="M20 4v4h-4"/>',doc:'<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/>',check:'<path d="M4 17l6-6 4 4 6-7"/>',search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',arrow:'<path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/>'};return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.search)+'</svg>'}
function FolderIcon(color){return '<svg viewBox="0 0 24 24" fill="'+color+'" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>'}
function ChevronDown(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>'}
function Avatar(name,size){return '<span class="avatar'+(size?' '+size:'')+'" aria-hidden="true">'+esc(avatarInitials(name))+'</span>'}
function StatusBadge(label,key,dotted){return '<span class="status-badge status-'+key+(dotted?' dotted':'')+'">'+esc(label)+'</span>'}
function Breadcrumbs(items){return '<nav class="breadcrumbs" aria-label="Breadcrumb">'+items.map((item,index)=>(index?'<span aria-hidden="true">/</span>':'')+(item.href?'<a href="'+item.href+'">'+esc(item.label)+'</a>':'<span aria-current="page">'+esc(item.label)+'</span>')).join('')+'</nav>'}
function PageHeader(options){const identity=options.identity?'<div class="profile-title">'+Avatar(options.identity.name,'large')+'<div><h1 class="profile-name">'+esc(options.identity.name)+'</h1><div class="profile-email">'+esc(options.identity.email||'')+'</div>'+(options.identity.badges||'')+'</div></div>':'';const title=identity||'<div class="page-title-row"><h1 class="page-title">'+esc(options.title)+'</h1>'+(options.meta||'')+'</div><p class="page-description">'+esc(options.description||'')+'</p>';return '<header class="page-header"><div>'+(options.breadcrumbs||'')+title+'</div>'+(options.actions||'')+'</header>'}
function SectionHeader(title,description,tools){return '<div class="panel-header"><div><h2 class="panel-title">'+esc(title)+'</h2>'+(description?'<p class="panel-description">'+esc(description)+'</p>':'')+'</div>'+(tools||'')+'</div>'}
function Panel(options){return '<section class="panel'+(options.className?' '+options.className:'')+'"'+(options.id?' id="'+options.id+'"':'')+'>'+(options.header||'')+'<div class="panel-body'+(options.padded?' padded':'')+'">'+options.body+'</div></section>'}
function StatCard(label,value,note,icon,tone,flag){return '<article class="stat-card'+(tone?' tone-'+tone:'')+'"><div class="stat-card-top"><span class="stat-icon">'+Icon(icon)+'</span>'+(flag?'<span class="stat-flag" aria-hidden="true"></span>':'')+'</div><div class="stat-label">'+esc(label)+'</div><div class="stat-foot"><span class="stat-note">'+esc(note)+'</span><strong class="stat-value">'+value+'</strong></div></article>'}
function EmptyState(message,dashed){return '<div class="empty-state'+(dashed?' dashed':'')+'"><span class="empty-icon">'+Icon('search')+'</span><span>'+esc(message)+'</span></div>'}
function SearchInput(id,placeholder,label){return '<label class="sr-only" for="'+id+'">'+esc(label)+'</label><div class="field search"><span class="field-icon">'+Icon('search')+'</span><input class="control" id="'+id+'" type="search" placeholder="'+esc(placeholder)+'"></div>'}
function SelectControl(id,label,options){return '<label class="sr-only" for="'+id+'">'+esc(label)+'</label><div class="field"><select class="control" id="'+id+'">'+options.map(option=>'<option value="'+option.value+'">'+esc(option.label)+'</option>').join('')+'</select></div>'}
function PrimaryButton(label,href,ariaLabel,newWindow){return '<a class="button primary" href="'+href+'"'+(newWindow?' target="_blank" rel="noopener"':'')+' aria-label="'+esc(ariaLabel||label)+'">'+esc(label)+'</a>'}
function SecondaryButton(label,href,ariaLabel){return '<a class="button" href="'+href+'" aria-label="'+esc(ariaLabel||label)+'">'+esc(label)+'</a>'}
function DataRow(options){return '<a class="data-row'+(options.className?' '+options.className:'')+'" href="'+options.href+'" aria-label="'+esc(options.ariaLabel)+'">'+options.main+(options.meta||'')+(options.tail||'')+'<span class="chevron" aria-hidden="true">›</span></a>'}
function MetadataList(items){return '<dl class="metadata-list">'+items.map(item=>'<div><dt class="metadata-label">'+esc(item.label)+'</dt><dd class="metadata-value'+(item.technical?' technical':'')+'">'+esc(item.value)+'</dd></div>').join('')+'</dl>'}
function DetailsDisclosure(items){return '<details class="details-disclosure"><summary>Advanced Details</summary>'+MetadataList(items)+'</details>'}
function remainingLabel(days){if(days===0)return 'Expires today';if(days<0)return 'Expired '+Math.abs(days)+' day'+(Math.abs(days)===1?'':'s')+' ago';return days+' day'+(days===1?'':'s')+' remaining'}
function tierTransition(contract){return contract.nextTier?'Tier '+contract.currentTier+' → Tier '+contract.nextTier:'Tier '+contract.currentTier}
const FOLDER_THEMES={'W-2':{bg:'#ffc629',foot:'rgba(255,255,255,.42)',ink:'#2e2300',icon:'#171a1f',pill:'#8a6a00',chevronBg:'rgba(255,255,255,.45)',chevronInk:'#6b5200',ring:'#ffc629',tints:[['#fff3cd','#8a6a00'],['#ffe9a8','#8a6a00'],['#ffffff','#8a6a00']],note:'Employed representatives'},'1099':{bg:'#7b61ff',foot:'rgba(255,255,255,.28)',ink:'#ffffff',icon:'#ffffff',pill:'#5b41d6',chevronBg:'rgba(255,255,255,.24)',chevronInk:'#ffffff',ring:'#7b61ff',tints:[['#ded7ff','#3f2ba8'],['#eae5ff','#3f2ba8'],['#ffffff','#3f2ba8']],note:'Independent contractors'}};
function FolderCard(type,reps){const theme=FOLDER_THEMES[type];const matching=trackedContractReps(reps,type);const stack=avatarStack(matching);const key=folderKey(type);const chip=(index)=>'background:'+theme.tints[index%theme.tints.length][0]+';color:'+theme.tints[index%theme.tints.length][1]+';border:2.5px solid '+theme.ring;const avatars=stack.shown.map((rep,index)=>'<span class="avatar" style="'+chip(index)+'" aria-hidden="true">'+esc(avatarInitials(rep.name))+'</span>').join('');const overflow=stack.overflow?'<span class="stack-more" style="'+chip(2)+'" aria-hidden="true">+'+stack.overflow+'</span>':'';const top=matching.length?'<span class="avatar-stack">'+avatars+overflow+'</span>':'<span class="folder-empty" style="color:'+theme.ink+'">No representatives yet</span>';return '<div class="folder-anchor"><button class="folder" type="button" data-folder="'+type+'" aria-haspopup="dialog" aria-expanded="false" aria-controls="folder-popover-'+key+'" style="background:'+theme.bg+'"><span class="folder-top">'+top+'<span class="folder-chevron" style="background:'+theme.chevronBg+';color:'+theme.chevronInk+'" aria-hidden="true">'+ChevronDown()+'</span></span><span class="folder-foot" style="background:'+theme.foot+'">'+FolderIcon(theme.icon)+'<span class="folder-name" style="color:'+theme.ink+'">'+type+' Contracts</span><span class="folder-count" style="color:'+theme.pill+'">'+plural(matching.length,'rep')+'</span></span></button>'+FolderPopover(type,matching)+'</div>'}
function FolderPopover(type,matching){const key=folderKey(type);const rows=matching.map(rep=>{const contract=rep.contract;const status=contractStatus(contract.daysRemaining);return '<a class="popover-row" href="/documents/reps/'+encodeURIComponent(rep.repId)+'" aria-label="Open '+esc(rep.name)+'">'+Avatar(rep.name,'small')+'<span class="popover-copy"><span class="popover-name">'+esc(rep.name)+'</span><span class="popover-meta">Tier '+contract.currentTier+' · '+esc(status.label)+' · Expires '+esc(dateOnly(contract.expiresAt))+'</span></span><span class="chevron" aria-hidden="true">›</span></a>'}).join('');const body=matching.length?rows:'<div class="popover-empty">No representatives yet</div>';return '<div class="popover" id="folder-popover-'+key+'" role="dialog" aria-label="'+type+' contract representatives" tabindex="-1" hidden><div class="popover-title">'+type+' Contracts<span>'+plural(matching.length,'rep')+'</span></div>'+body+'</div>'}
function initFolders(){const cards=[...document.querySelectorAll('[data-folder]')];const popover=card=>document.querySelector('#folder-popover-'+folderKey(card.dataset.folder));const close=card=>{popover(card).hidden=true;card.setAttribute('aria-expanded','false')};const closeAll=()=>{for(const card of cards)close(card)};const toggle=card=>{const target=popover(card);const opening=target.hidden;closeAll();if(!opening)return;target.hidden=false;card.setAttribute('aria-expanded','true');(target.querySelector('a')||target).focus({preventScroll:true})};for(const card of cards){card.addEventListener('click',()=>toggle(card));card.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();toggle(card)})}document.addEventListener('click',event=>{if(!event.target.closest('.folder-anchor'))closeAll()});document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=cards.find(card=>card.getAttribute('aria-expanded')==='true');if(!open)return;closeAll();open.focus()})}
function FilterPills(reps,showStats){const summary=dashboardSummary(reps);const distribution=contractDistribution(reps);const pill=(type,count,label)=>'<button class="pill" type="button" role="tab" aria-selected="'+(type==='all'?'true':'false')+'" aria-controls="rep-results" data-contract-type="'+type+'"><strong>'+count+'</strong> <span>'+esc(label)+'</span></button>';const stat=(count,label)=>'<span class="pill static"><strong>'+count+'</strong> <span>'+esc(label)+'</span></span>';return '<div class="filter-pills" role="tablist" aria-label="Representative contract type">'+pill('all',distribution.tracked,'All contracts')+pill('W-2',distribution['W-2'],'W-2')+pill('1099',distribution['1099'],'1099')+(showStats?stat(summary.renewalsDueSoon,'Renewals due')+stat(summary.expired,'Expired'):'')+'</div>'}
function tierCards(reps){const distribution=contractDistribution(reps);return '<div class="stat-grid" role="group" aria-label="Contract tier summary">'+StatCard('Tier 1',distribution.tier1,'Initial term','chart','',indicatorVisible(distribution.tier1))+StatCard('Tier 2',distribution.tier2,'First renewal','chart','green',indicatorVisible(distribution.tier2))+StatCard('Tier 3',distribution.tier3,'Long term','chart','violet',indicatorVisible(distribution.tier3))+StatCard('Expired',distribution.expired,'Renewal required','alert','red',indicatorVisible(distribution.expired))+'</div>'}
function DonutRing(distribution){const circumference=527.79;const total=distribution.tracked;const segments=[[distribution.healthy,'#12b47a'],[distribution.dueSoon,'#ffc629'],[distribution.expired,'#ff6b6b']].filter(segment=>segment[0]>0);let offset=0;const arcs=total?segments.map(segment=>{const length=circumference*(segment[0]/total);const arc='<circle cx="98" cy="98" r="84" fill="none" stroke="'+segment[1]+'" stroke-width="10" stroke-dasharray="'+length.toFixed(2)+' '+(circumference-length).toFixed(2)+'" stroke-dashoffset="'+(-offset).toFixed(2)+'"></circle>';offset+=length;return arc}).join(''):'';return '<div class="donut"><svg width="196" height="196" viewBox="0 0 196 196" aria-hidden="true"><circle cx="98" cy="98" r="84" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"></circle>'+arcs+'</svg><div class="donut-center"><div class="donut-value">'+total+'</div><div class="donut-label">contracts tracked</div></div></div>'}
function OverviewLine(color,ink,icon,title,note,value){return '<div class="overview-line"><span class="overview-line-icon" style="background:'+color+';color:'+ink+'">'+Icon(icon)+'</span><span class="overview-line-copy"><strong>'+esc(title)+'</strong><span>'+esc(note)+'</span></span><span class="overview-line-value">'+value+'</span></div>'}
function renderOverviewPanel(reps){const panel=document.querySelector('#overview-panel');const distribution=contractDistribution(reps);const summary=dashboardSummary(reps);const attention=attentionContracts(reps).length;const upcoming=upcomingContracts(reps).length;const expiredChip=indicatorVisible(summary.expired)?'<span class="overview-chip">'+summary.expired+' expired</span>':'';panel.innerHTML='<div class="overview-head"><h2>Contract Overview</h2>'+expiredChip+'</div>'+DonutRing(distribution)+'<div class="overview-split"><div class="overview-tile"><div class="overview-tile-label">Total Active</div><div class="overview-tile-value">'+summary.activeReps+'</div></div><div class="overview-tile"><div class="overview-tile-label">Renewals Due</div><div class="overview-tile-value">'+summary.renewalsDueSoon+'</div></div></div><div class="overview-block">'+OverviewLine('#7b61ff','#fff','doc','1099 Contracts','Independent contractors',distribution['1099'])+OverviewLine('#ffc629','#3a2c00','doc','W-2 Contracts','Employed representatives',distribution['W-2'])+OverviewLine('#4fd1c5','#0c3b37','refresh','Renewals','Expiring in 31–90 days',upcoming)+OverviewLine('#ff6b6b','#fff','alert','Needs Attention','Expired or under 30 days',attention)+'</div><div class="overview-legend"><div class="overview-legend-title">Tier distribution</div><div class="overview-legend-list">'+[['Tier 1','#2f8bff',distribution.tier1],['Tier 2','#4fd1c5',distribution.tier2],['Tier 3','#7b61ff',distribution.tier3],['Expired','#ff6b6b',distribution.expired]].map(row=>'<div class="overview-legend-row"><span style="background:'+(indicatorVisible(row[2])?row[1]:'rgba(255,255,255,.18)')+'"></span><span>'+row[0]+'</span><strong>'+row[2]+'</strong></div>').join('')+'</div></div>';panel.hidden=false}
function AttentionRow(rep,upcoming){const contract=rep.contract;const status=contractStatus(contract.daysRemaining);const urgent=['expired','action'].includes(status.key);return '<a class="attention-row'+(upcoming?' is-upcoming':urgent?' is-urgent':'')+'" href="/documents/reps/'+encodeURIComponent(rep.repId)+'" aria-label="View '+esc(rep.name)+' contract">'+(upcoming?'':'<span class="urgency-bar" aria-hidden="true"></span>')+Avatar(rep.name,'small')+'<span class="attention-copy"><span class="attention-name">'+esc(rep.name)+'</span><span class="attention-meta">'+esc(tierTransition(contract))+' · '+esc(dateOnly(contract.expiresAt))+'</span></span><span class="attention-time">'+StatusBadge(status.label,status.key,true)+'<span>'+esc(remainingLabel(contract.daysRemaining))+'</span></span></a>'}
function renewalPanels(reps){const attention=attentionContracts(reps);const upcoming=upcomingContracts(reps);const count=(value,urgent)=>'<span class="panel-count'+(urgent&&indicatorVisible(value)?' is-urgent':'')+'">'+value+'</span>';const attentionPanel=Panel({id:'needs-attention',header:SectionHeader('Needs Attention','Expired contracts and renewals due within 30 days.',count(attention.length,true)),body:attention.length?'<div class="attention-list">'+attention.map(rep=>AttentionRow(rep,false)).join('')+'</div>':EmptyState('No contracts currently require attention.')});const upcomingPanel=Panel({id:'upcoming-renewals',header:SectionHeader('Upcoming Renewals','Active contracts expiring in 31–90 days.',count(upcoming.length,false)),body:upcoming.length?'<div class="attention-list">'+upcoming.map(rep=>AttentionRow(rep,true)).join('')+'</div>':EmptyState('No upcoming renewals.')});return '<div class="panel-grid">'+attentionPanel+upcomingPanel+'</div>'}
function RepRow(rep){const contract=rep.contract;const status=contract?.currentTier?contractStatus(contract.daysRemaining):undefined;const main='<div class="data-row-main">'+Avatar(rep.name)+'<div class="data-row-copy"><div class="data-row-title">'+esc(rep.name)+'</div><div class="data-row-subtitle">'+esc(rep.email||(rep.type==='requires_resolution'?'Signer identity requires review':'No completed signer resolved'))+'</div></div></div>';const meta='<div class="data-row-meta">'+(contract?.currentTier?StatusBadge(contract.contractType||'Unknown','contract')+StatusBadge('Tier '+contract.currentTier,'tier')+StatusBadge(status.label,status.key,true):StatusBadge('No Contract','neutral'))+'</div>';const tail='<div class="data-row-tail">'+(contract?.currentTier?'<strong>Expires '+esc(dateOnly(contract.expiresAt))+'</strong>':'')+'<span>'+plural(rep.completedEnvelopeCount,'agreement')+'</span></div>';return DataRow({href:'/documents/reps/'+encodeURIComponent(rep.repId),ariaLabel:'View '+rep.name+' contract details',main,meta,tail})}
function renderRepResults(reps,limit){const shown=limit?dashboardPreviewReps(reps,limit):reps;document.querySelector('#rep-results').innerHTML=shown.length?'<div class="data-list">'+shown.map(RepRow).join('')+'</div>':EmptyState('No representatives found.',true)}
function updateNavCounts(reps){const attention=attentionContracts(reps).length;const badge=document.querySelector('#nav-attention-count');badge.textContent=attention;badge.hidden=!indicatorVisible(attention)}
function bindRepControls(limit){let contractType='all';const load=async()=>{const query=new URLSearchParams({search:document.querySelector('#rep-search').value,sort:document.querySelector('#rep-sort').value});if(contractType!=='all')query.set('contractType',contractType);renderRepResults((await api('/api/reps?'+query)).reps,limit)};for(const tab of document.querySelectorAll('[data-contract-type]'))tab.addEventListener('click',()=>{contractType=tab.dataset.contractType;for(const item of document.querySelectorAll('[data-contract-type]'))item.setAttribute('aria-selected',String(item===tab));load()});document.querySelector('#rep-search').addEventListener('input',load);document.querySelector('#rep-sort').addEventListener('change',load)}
const SORT_OPTIONS=[{value:'recent',label:'Recent Activity'},{value:'name',label:'Name'},{value:'count',label:'Agreement Count'},{value:'expiration',label:'Contract Expiration'}];
async function dashboardPage(){const initial=await api('/api/reps?sort=recent');document.querySelector('#topbar-search').hidden=false;const activeMeta='<span class="active-pill"><span class="active-pill-mark" aria-hidden="true">'+Icon('check')+'</span>'+dashboardSummary(initial.reps).activeReps+' active</span>';const tools='<div class="section-tools">'+SelectControl('rep-sort','Sort representatives',SORT_OPTIONS)+'<a class="link-action" href="/representatives">View All Representatives'+Icon('arrow')+'</a></div>';app.innerHTML=PageHeader({title:'Contract Management',description:'Manage representative agreements, contract status, and renewals.',meta:activeMeta})+FilterPills(initial.reps,true)+'<div class="folder-grid">'+FolderCard('W-2',initial.reps)+FolderCard('1099',initial.reps)+'</div>'+renewalPanels(initial.reps)+tierCards(initial.reps)+'<div class="section-header" id="representatives"><div><h2 class="section-title">Representatives</h2><p class="section-description">Top '+DASHBOARD_PREVIEW_LIMIT+' for the current filter and sort.</p></div>'+tools+'</div><div id="rep-results" role="tabpanel"></div>';renderRepResults(initial.reps,DASHBOARD_PREVIEW_LIMIT);renderOverviewPanel(initial.reps);updateNavCounts(initial.reps);initFolders();bindRepControls(DASHBOARD_PREVIEW_LIMIT);scrollToHash()}
async function representativesPage(){const initial=await api('/api/reps?sort=recent');document.querySelector('#topbar-search').hidden=false;const tools='<div class="section-tools">'+SelectControl('rep-sort','Sort representatives',SORT_OPTIONS)+'</div>';app.innerHTML=PageHeader({breadcrumbs:Breadcrumbs([{label:'Dashboard',href:'/documents'},{label:'Representatives'}]),title:'Representatives',description:'Every representative with a completed agreement, including contract type, tier, and expiration.'})+FilterPills(initial.reps,false)+'<div class="section-header"><div><h2 class="section-title">All Representatives</h2><p class="section-description">Filter by contract type, search by name or email, and sort the full list.</p></div>'+tools+'</div><div id="rep-results" role="tabpanel"></div>';renderRepResults(initial.reps);updateNavCounts(initial.reps);bindRepControls()}
function Tabs(items){return '<div class="tabs" role="tablist" aria-label="Representative sections">'+items.map((item,index)=>'<button class="tab" id="tab-'+item.id+'" type="button" role="tab" aria-selected="'+(index===0?'true':'false')+'" aria-controls="panel-'+item.id+'" tabindex="'+(index===0?'0':'-1')+'" data-tab="'+item.id+'">'+esc(item.label)+'</button>').join('')+'</div>'}
function activateTab(id,focus){const tabs=[...document.querySelectorAll('[data-tab]')];if(!tabs.some(tab=>tab.dataset.tab===id))id=tabs[0]?.dataset.tab;for(const tab of tabs){const active=tab.dataset.tab===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.querySelector('#panel-'+tab.dataset.tab).hidden=!active;if(active&&focus)tab.focus()}if(id)history.replaceState(null,'','#'+id)}
function initTabs(){const tabs=[...document.querySelectorAll('[data-tab]')];for(const tab of tabs){tab.addEventListener('click',()=>activateTab(tab.dataset.tab));tab.addEventListener('keydown',event=>{const index=tabs.indexOf(tab);let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();activateTab(tabs[next].dataset.tab,true)}})}const requested=location.hash.slice(1);activateTab(tabs.some(tab=>tab.dataset.tab===requested)?requested:'overview')}
function CurrentContractPanel(contract){if(!contract?.currentTier)return EmptyState('No tracked contract is available for this representative.',true);const status=contractStatus(contract.daysRemaining);const stats=[['Contract Type',contract.contractType||'Unknown'],['Current Tier','Tier '+contract.currentTier],['Signed',dateOnly(contract.signedAt)],['Expiration',dateOnly(contract.expiresAt)],['Next Tier',contract.nextTier?'Tier '+contract.nextTier:'—']].map(item=>'<article class="contract-stat"><div class="contract-stat-label">'+item[0]+'</div><div class="contract-stat-value">'+esc(item[1])+'</div></article>').join('');return '<div class="contract-stats">'+stats+'</div><div class="contract-status status-'+status.key+'"><div><strong>Contract Status</strong><div class="contract-status-copy">'+esc(status.detail)+'</div></div><div class="contract-status-tail"><span class="contract-status-chip">'+esc(status.label)+'</span><span class="contract-status-remaining">'+esc(remainingLabel(contract.daysRemaining))+'</span></div></div>'}
function ContractHistoryRow(item,contract){const current=item.envelopeId===contract.currentContract?.envelopeId;const expired=current&&contract.daysRemaining<=0;const label=expired?'Expired':current?'Active':'Renewed';const key=expired?'expired':current?'active':'neutral';const main='<div class="data-row-main"><span class="file-mark" aria-hidden="true">PDF</span><div class="data-row-copy"><div class="data-row-title">'+esc((item.contractType||'Unknown')+' Agreement')+'</div><div class="data-row-subtitle">Signed '+esc(dateOnly(item.signedAt))+' → '+esc(dateOnly(item.expiresAt))+'</div></div></div>';const meta='<div class="data-row-meta">'+StatusBadge('Tier '+item.tier,'tier')+StatusBadge(label,key)+'</div>';return DataRow({href:'/documents/envelopes/'+encodeURIComponent(item.envelopeId),ariaLabel:'Open Tier '+item.tier+' agreement',className:'history-row',main,meta})}
function ContractHistoryPanel(contract){const history=(contract?.contracts||[]).map(item=>ContractHistoryRow(item,contract)).join('');return history?'<div class="data-list">'+history+'</div>':EmptyState('No contract history found.',true)}
function AgreementRow(env){const name=primaryAgreementName(env);const main='<div class="data-row-main"><span class="file-mark" aria-hidden="true">PDF</span><div class="data-row-copy"><div class="data-row-title">'+esc(name)+'</div><div class="document-meta">'+StatusBadge('Signed Agreement','signed')+'<span>Completed '+esc(date(env.completedAt))+' · '+esc(plural(env.documentCount,'document'))+'</span></div></div></div>';return DataRow({href:'/documents/envelopes/'+encodeURIComponent(env.envelopeId),ariaLabel:'Open '+name,main})}
function DocumentsPanel(envelopes){const toolbar='<div class="toolbar">'+SearchInput('document-search','Search documents...','Search completed documents')+SelectControl('document-sort','Sort completed documents',[{value:'newest',label:'Newest Completed'},{value:'oldest',label:'Oldest Completed'},{value:'name',label:'Document Name'}])+'</div>';return Panel({className:'spaced',header:SectionHeader('Documents & Agreements','Completed agreements and supporting documents.',toolbar),padded:true,body:'<div id="agreement-results">'+(envelopes.length?'<div class="data-list">'+envelopes.map(AgreementRow).join('')+'</div>':EmptyState('No completed documents for this representative.',true))+'</div>'})}
function renderAgreementResults(envelopes){document.querySelector('#agreement-results').innerHTML=envelopes.length?'<div class="data-list">'+envelopes.map(AgreementRow).join('')+'</div>':EmptyState('No completed documents for this representative.',true)}
async function repPage(repId){const endpoint='/api/reps/'+encodeURIComponent(repId)+'/envelopes';const data=await api(endpoint);document.querySelector('#back-button').hidden=false;const contract=data.contract;const status=contract?.currentTier?contractStatus(contract.daysRemaining):undefined;const badges='<div class="profile-badges">'+(contract?.currentTier?StatusBadge(contract.contractType||'Unknown','contract')+StatusBadge('Tier '+contract.currentTier,'tier')+StatusBadge(status.label,status.key,true):StatusBadge('No Contract','neutral'))+'</div>';const header=PageHeader({breadcrumbs:Breadcrumbs([{label:'Representatives',href:'/representatives'},{label:data.rep.name}]),identity:{name:data.rep.name,email:data.rep.email||(data.rep.type==='requires_resolution'?'Signer identity requires review':'No completed signer resolved'),badges}});const tabs=Tabs([{id:'overview',label:'Overview'},{id:'history',label:'Contract History'},{id:'documents',label:'Documents'}]);app.innerHTML=header+tabs+'<section class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">'+CurrentContractPanel(contract)+'</section><section class="tab-panel" id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden><h2 class="sr-only">Contract History</h2>'+ContractHistoryPanel(contract)+'</section><section class="tab-panel" id="panel-documents" role="tabpanel" aria-labelledby="tab-documents" hidden>'+DocumentsPanel(data.envelopes)+'</section>';initTabs();const load=async()=>{const query=new URLSearchParams({search:document.querySelector('#document-search').value,sort:document.querySelector('#document-sort').value});renderAgreementResults((await api(endpoint+'?'+query)).envelopes)};document.querySelector('#document-search').addEventListener('input',load);document.querySelector('#document-sort').addEventListener('change',load)}
function DocumentRow(envelopeId,document){const presentation=documentPresentation(document.classification);const size=formatFileSize(document.bytes);const base='/api/docusign/envelopes/'+encodeURIComponent(envelopeId)+'/documents/'+encodeURIComponent(document.documentId);const main='<div class="data-row-main"><span class="file-mark" aria-hidden="true">PDF</span><div class="data-row-copy"><div class="data-row-title">'+esc(document.name)+'</div><div class="document-meta">'+StatusBadge(presentation.badge,presentation.key)+'<span>'+esc(presentation.heading)+(size?' · '+esc(size):'')+'</span></div></div></div>';const actions='<div class="document-actions">'+PrimaryButton('View PDF',base,'View '+document.name,true)+SecondaryButton('Download',base+'?download=true','Download '+document.name)+'</div>';return '<article class="data-row document-row'+(presentation.key==='signed'?' is-signed':'')+'">'+main+actions+'</article>'}
async function agreementPage(envelopeId){const env=await api('/api/docusign/envelopes/'+encodeURIComponent(envelopeId));document.querySelector('#back-button').hidden=false;const repId=env.rep?.repId||'unassigned';let repName=env.rep?.name||'Representative';if(repId.includes('@')){try{const repData=await api('/api/reps/'+encodeURIComponent(repId)+'/envelopes');repName=repData.rep?.name||repName}catch{}}const title=primaryAgreementName(env);const order={signed_document:0,supplemental:1,certificate:2};const documents=[...(env.documents||[])].sort((a,b)=>(order[a.classification]??1)-(order[b.classification]??1));const header=PageHeader({breadcrumbs:Breadcrumbs([{label:'Representatives',href:'/representatives'},{label:repName,href:'/documents/reps/'+encodeURIComponent(repId)},{label:title}]),title,description:'Completed '+date(env.completedAt)});const documentPanel=Panel({className:'spaced',header:SectionHeader('Documents','Signed agreement files and supporting records.'),padded:true,body:documents.length?'<div class="data-list">'+documents.map(document=>DocumentRow(envelopeId,document)).join('')+'</div>':EmptyState('No documents found for this agreement.',true)});const details=DetailsDisclosure([{label:'Envelope ID',value:env.envelopeId,technical:true},{label:'Sender',value:env.sender?.email||'Unknown sender'},{label:'Completed At',value:date(env.completedAt)},{label:'Document Count',value:String(env.documentCount??documents.length)}]);app.innerHTML=header+documentPanel+details}
function scrollToHash(){const target=location.hash&&document.querySelector(location.hash);if(target)requestAnimationFrame(()=>target.scrollIntoView({block:'start'}))}
function showError(error){app.innerHTML='<div class="error" role="alert">'+esc(error.message)+'</div>'}
function initShell(){const shell=document.querySelector('#app-shell');const toggle=document.querySelector('#nav-toggle');toggle.addEventListener('click',()=>{const collapsed=shell.classList.toggle('nav-collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation')});const dashboard=location.pathname==='/documents'||location.pathname==='/documents/';document.querySelector(dashboard?'#nav-dashboard':'#nav-reps').setAttribute('aria-current','page')}
const path=location.pathname;
initShell();
Promise.resolve().then(()=>{let match;if(path==='/documents'||path==='/documents/')return dashboardPage();if(path==='/representatives'||path==='/representatives/')return representativesPage();if(match=path.match(new RegExp('^/documents/reps/([^/]+)$')))return repPage(decodeURIComponent(match[1]));if(match=path.match(new RegExp('^/documents/envelopes/([^/]+)$')))return agreementPage(decodeURIComponent(match[1]));throw new Error('Page not found')}).catch(showError);
</script></body></html>`;
