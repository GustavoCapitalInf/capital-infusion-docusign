const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : '';
}

export function isInternalRepEmail(email, domain = 'capital-infusion.com') {
  const normalized = normalizeEmail(email);
  const normalizedDomain = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  return Boolean(normalized && normalizedDomain && normalized.endsWith(`@${normalizedDomain}`));
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

export function resolveRepFromSender(sender = {}, domain = 'capital-infusion.com') {
  const email = normalizeEmail(sender.email || sender.emailAddress);
  if (!isInternalRepEmail(email, domain)) {
    return { repId: 'unassigned', type: 'unassigned', email: email || undefined, name: 'Unknown Rep' };
  }
  const suppliedName = String(sender.name || sender.userName || '').trim();
  return {
    repId: email,
    type: 'internal',
    email,
    name: suppliedName || displayNameFromEmail(email),
  };
}
