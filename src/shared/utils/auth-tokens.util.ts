import { randomBytes, randomInt, createHash } from 'node:crypto';

/** 6-digit numeric code — used for account verification and family invites. */
export function generateNumericCode(length = 6): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return randomInt(min, max).toString();
}

/** Opaque URL-safe token — used for password reset links. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** auth_tokens.tokenHash stores this, never the raw code/token. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
