const CONTRACT_TYPE_PATTERNS = [
  ['W-2', /^Employment_Offer_and_Agreement.*\.pdf$/i],
  ['1099', /^Capital_Infusion_IC_Account_Executive_Agreement.*\.pdf$/i],
];
export const REMINDER_THRESHOLDS = [30, 15, 7, 0];

function documentName(document) {
  return String(document?.name || document?.originalName || '').trim();
}

export function classifyContractType(filename) {
  const name = String(filename || '').trim();
  return CONTRACT_TYPE_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0];
}

export function isTrackedEmploymentContract(filename) {
  return Boolean(classifyContractType(filename));
}

function contractTypeForDocument(document) {
  const direct = classifyContractType(documentName(document));
  if (direct) return direct;
  const storedName = String(document?.storedName || '').trim();
  const documentId = String(document?.documentId || '').trim();
  const storedPrefix = `${documentId}-`;
  if (!storedName || !documentId || !storedName.startsWith(storedPrefix)) return undefined;
  return classifyContractType(storedName.slice(storedPrefix.length));
}

export function trackedContractDocuments(documents = []) {
  return documents.filter((document) => {
    if (['certificate', 'supplemental'].includes(document?.classification)) return false;
    if (document?.type && document.type !== 'content') return false;
    return Boolean(contractTypeForDocument(document));
  });
}

export function addCalendarMonths(timestamp, months) {
  const source = new Date(timestamp);
  if (Number.isNaN(source.getTime())) throw new Error('Invalid contract signing timestamp');
  const targetMonth = source.getUTCMonth() + months;
  const first = new Date(Date.UTC(
    source.getUTCFullYear(),
    targetMonth,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return first.toISOString();
}

export function calendarDaysUntil(timestamp, now = new Date()) {
  const target = new Date(timestamp);
  const current = new Date(now);
  if (Number.isNaN(target.getTime()) || Number.isNaN(current.getTime())) throw new Error('Invalid reminder timestamp');
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const currentDay = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  return Math.round((targetDay - currentDay) / 86_400_000);
}

export function reminderThresholdForDays(daysRemaining) {
  if (daysRemaining > 30) return undefined;
  if (daysRemaining > 15) return 30;
  if (daysRemaining > 7) return 15;
  if (daysRemaining > 0) return 7;
  return 0;
}

export function recomputeContractLifecycle(identity, contracts, resolutions, updatedAt) {
  const sorted = [...contracts].sort((a, b) =>
    String(a.signedAt).localeCompare(String(b.signedAt)) || String(a.envelopeId).localeCompare(String(b.envelopeId)));
  const tiered = sorted.map((contract, index) => ({
    ...contract,
    tier: Math.min(index + 1, 3),
    status: index === sorted.length - 1 ? 'active' : 'superseded',
  }));
  const currentContract = tiered.at(-1);
  return {
    schemaVersion: 2,
    repId: identity.repId,
    repEmail: identity.email,
    repName: identity.name,
    currentTier: currentContract?.tier,
    nextTier: currentContract && currentContract.tier < 3 ? currentContract.tier + 1 : null,
    currentContract,
    contracts: tiered,
    contractResolutions: resolutions,
    requiresContractResolution: resolutions.length > 0,
    updatedAt,
  };
}

export function applyCompletedEnvelopeToLifecycle(current, envelope, updatedAt = new Date().toISOString()) {
  const tracked = trackedContractDocuments(envelope.documents);
  if (!tracked.length) return { changed: false, lifecycle: current };
  const identity = {
    repId: envelope.rep.repId,
    email: envelope.rep.email,
    name: envelope.rep.name,
  };
  const contracts = [...(current?.contracts || [])];
  let resolutions = [...(current?.contractResolutions || [])];

  if (tracked.length > 1) {
    if (resolutions.some((item) => item.envelopeId === envelope.envelopeId)) {
      return { changed: false, lifecycle: current };
    }
    resolutions.push({
      envelopeId: envelope.envelopeId,
      completedAt: envelope.completedAt,
      trackedDocumentCount: tracked.length,
      documentIds: tracked.map((document) => String(document.documentId)),
      status: 'requires_contract_resolution',
    });
    return { changed: true, lifecycle: recomputeContractLifecycle(identity, contracts, resolutions, updatedAt) };
  }

  const document = tracked[0];
  const contractType = contractTypeForDocument(document);
  const existingContract = contracts.find((contract) => contract.envelopeId === envelope.envelopeId);
  if (existingContract) {
    if (existingContract.contractType === contractType) return { changed: false, lifecycle: current };
    const updatedContracts = contracts.map((contract) => contract.envelopeId === envelope.envelopeId
      ? { ...contract, contractType }
      : contract);
    return {
      changed: true,
      lifecycle: recomputeContractLifecycle(identity, updatedContracts, resolutions, updatedAt),
    };
  }
  resolutions = resolutions.filter((item) => item.envelopeId !== envelope.envelopeId);
  contracts.push({
    envelopeId: envelope.envelopeId,
    documentId: String(document.documentId),
    documentName: documentName(document),
    contractType,
    signedAt: new Date(envelope.completedAt).toISOString(),
    expiresAt: addCalendarMonths(envelope.completedAt, 6),
  });
  return { changed: true, lifecycle: recomputeContractLifecycle(identity, contracts, resolutions, updatedAt) };
}

export function buildContractLifecycle(rep, envelopes, updatedAt = new Date().toISOString()) {
  let lifecycle;
  const sorted = [...envelopes].sort((a, b) =>
    String(a.completedAt).localeCompare(String(b.completedAt)) || String(a.envelopeId).localeCompare(String(b.envelopeId)));
  for (const envelope of sorted) {
    lifecycle = applyCompletedEnvelopeToLifecycle(lifecycle, { ...envelope, rep }, updatedAt).lifecycle;
  }
  return lifecycle;
}

export function publicContractLifecycle(lifecycle, now = new Date()) {
  if (!lifecycle) return undefined;
  return {
    repId: lifecycle.repId,
    repEmail: lifecycle.repEmail,
    repName: lifecycle.repName,
    currentTier: lifecycle.currentTier,
    nextTier: lifecycle.nextTier,
    currentContract: lifecycle.currentContract,
    contractType: lifecycle.currentContract?.contractType || 'unknown',
    signedAt: lifecycle.currentContract?.signedAt,
    expiresAt: lifecycle.currentContract?.expiresAt,
    daysRemaining: lifecycle.currentContract ? calendarDaysUntil(lifecycle.currentContract.expiresAt, now) : undefined,
    contracts: lifecycle.contracts || [],
    requiresContractResolution: Boolean(lifecycle.requiresContractResolution),
    contractResolutions: lifecycle.contractResolutions || [],
  };
}
