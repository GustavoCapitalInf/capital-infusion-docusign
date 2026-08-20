const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

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

export function resolveRepFromRecipients(recipients = {}) {
  // DocuSign returns CC recipients separately in `carbonCopies`; only entries
  // in `signers` have signing responsibility for this initial resolver.
  const signers = Array.isArray(recipients) ? recipients : recipients.signers || [];
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

  const candidates = [...unique.values()];
  if (candidates.length === 1) {
    const candidate = candidates[0];
    return {
      rep: { repId: candidate.email, type: 'signer', email: candidate.email, name: candidate.name },
      resolution: { status: 'resolved', completedSignerCount: 1 },
    };
  }
  if (candidates.length > 1) {
    return {
      rep: { repId: 'requires-resolution', type: 'requires_resolution', name: 'Rep Resolution Required' },
      resolution: { status: 'requires_resolution', completedSignerCount: candidates.length },
    };
  }
  return {
    rep: { repId: 'unassigned', type: 'unassigned', name: 'Unknown Rep' },
    resolution: { status: 'unassigned', completedSignerCount: 0 },
  };
}
