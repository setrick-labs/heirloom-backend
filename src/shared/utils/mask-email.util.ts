/**
 * "amina.khan@gmail.com" -> "a***@gmail.com". Enough for the owner to know
 * which inbox to check; not enough to hand a stranger the address.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
