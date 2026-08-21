const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
export const REP_RESOLVER_VERSION = 2;
const DEFAULT_INTERNAL_SIGNERS = new Set(['hr@capital-infusion.com']);

export function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : '';
}

export function displayNameFromEmail(email) {
  const local = normalizeEmail(email).split('@')[0] || '';
  if (!local) return 'Unknown Rep';
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'Unknown Rep';
}

function completedSigner(signer) {
  const status = String(signer?.status || '').trim().toLowerCase();
  return status === 'completed' || Boolean(signer?.signedDateTime);
}

function resolution(status, completedSignerCount, externalSignerCount, internalSignerCount) {
  return {
    status,
    completedSignerCount,
    externalSignerCount,
    internalSignerCount,
    resolverVersion: REP_RESOLVER_VERSION,
  };
}

export function resolveRepFromRecipients(recipients = {}, options = {}) {
  // DocuSign returns CC recipients separately in `carbonCopies`; only entries
  // in `signers` have signing responsibility. Known company signers are
  // excluded by exact normalized email; domains are intentionally not guessed.
  const signers = Array.isArray(recipients) ? recipients : recipients.signers || [];
  const internalSigners = new Set(
    [...DEFAULT_INTERNAL_SIGNERS, ...(options.internalSigners || [])]
      .map(normalizeEmail)
      .filter(Boolean),
  );
  const unique = new Map();
  for (const signer of signers) {
    if (!completedSigner(signer)) continue;
    const email = normalizeEmail(signer.email || signer.emailAddress);
    if (!email) continue;
    if (!unique.has(email)) {
      unique.set(email, {
        email,
        name: String(signer.name || signer.userName || '').trim() || displayNameFromEmail(email),
      });
    }
  }

  const completed = [...unique.values()];
  const candidates = completed.filter((candidate) => !internalSigners.has(candidate.email));
  const internalSignerCount = completed.length - candidates.length;
  if (candidates.length === 1) {
    const candidate = candidates[0];
    return {
      rep: { repId: candidate.email, type: 'signer', email: candidate.email, name: candidate.name },
      resolution: resolution('resolved', completed.length, 1, internalSignerCount),
    };
  }
  if (candidates.length > 1 || completed.length > 0) {
    return {
      rep: { repId: 'requires-resolution', type: 'requires_resolution', name: 'Rep Resolution Required' },
      resolution: resolution(
        'requires_resolution',
        completed.length,
        candidates.length,
        internalSignerCount,
      ),
    };
  }
  return {
    rep: { repId: 'unassigned', type: 'unassigned', name: 'Unknown Rep' },
    resolution: resolution('unassigned', 0, 0, 0),
  };
}
