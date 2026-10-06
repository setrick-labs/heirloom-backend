import { UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import type { Database } from '../../database/connection';
import { authTokens } from '../../database/schema';
import { generateNumericCode, hashToken } from './auth-tokens.util';

type AuthTokenType = (typeof authTokens.$inferInsert)['type'];
type AuthTokenRow = typeof authTokens.$inferSelect;

/**
 * The lifecycle every emailed 6-digit code shares — account verification,
 * password reset, Vault recovery, email change:
 *
 * - one live code per (user, type, scope): issuing a new one burns the old;
 * - a code is checked against the *latest live* row, not looked up by hash,
 *   so a wrong guess can be counted against it;
 * - at AUTH_CODE_MAX_ATTEMPTS wrong guesses the code is burned, which is
 *   what makes a million-value space safe against a guesser spread across
 *   many IPs (per-IP throttling alone does not).
 */

const INVALID = 'This code is invalid or has expired. Request a new one.';

function scopeCondition(scopeId: string | null | undefined) {
  return scopeId ? eq(authTokens.scopeId, scopeId) : isNull(authTokens.scopeId);
}

export async function issueEmailedCode(
  db: Database,
  input: {
    userId: string;
    type: AuthTokenType;
    ttlMinutes: number;
    scopeId?: string | null;
    email?: string | null;
  },
): Promise<string> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, input.userId),
        eq(authTokens.type, input.type),
        scopeCondition(input.scopeId),
        isNull(authTokens.usedAt),
      ),
    );

  const code = generateNumericCode(6);
  await db.insert(authTokens).values({
    userId: input.userId,
    type: input.type,
    tokenHash: hashToken(code),
    scopeId: input.scopeId ?? null,
    email: input.email ?? null,
    expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
  });
  return code;
}

/**
 * Checks `code` and, if it matches, marks it used and returns the row.
 * Throws a deliberately uniform 401 for every failure — unknown user,
 * no code, wrong code, expired — so the response never says which.
 */
export async function consumeEmailedCode(
  db: Database,
  input: {
    userId: string;
    type: AuthTokenType;
    code: string;
    scopeId?: string | null;
  },
): Promise<AuthTokenRow> {
  const record = await db.query.authTokens.findFirst({
    where: and(
      eq(authTokens.userId, input.userId),
      eq(authTokens.type, input.type),
      scopeCondition(input.scopeId),
      isNull(authTokens.usedAt),
    ),
    orderBy: desc(authTokens.createdAt),
  });

  if (!record || record.expiresAt <= new Date()) {
    throw new UnauthorizedException(INVALID);
  }

  if (record.tokenHash !== hashToken(input.code)) {
    const attempts = record.attempts + 1;
    const burned = attempts >= env.AUTH_CODE_MAX_ATTEMPTS;
    await db
      .update(authTokens)
      .set({
        attempts: sql`${authTokens.attempts} + 1`,
        ...(burned ? { usedAt: new Date() } : {}),
      })
      .where(eq(authTokens.id, record.id));
    throw new UnauthorizedException(
      burned ? 'Too many incorrect attempts. Request a new code.' : INVALID,
    );
  }

  // Conditional on still being unused, so two racing requests with the
  // right code can't both succeed.
  const [claimed] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, record.id), isNull(authTokens.usedAt)))
    .returning();
  if (!claimed) throw new UnauthorizedException(INVALID);
  return claimed;
}
