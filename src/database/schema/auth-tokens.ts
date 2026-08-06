import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

import { authTokenTypeEnum } from './enums';
import { users } from './users';

/**
 * Backs both account-verification codes and password-reset tokens — both
 * are "single-use, time-limited, delivered out of band" so one table with
 * a `type` tag avoids duplicating the same lifecycle logic twice.
 * `tokenHash` stores a SHA-256 hash, never the raw code/token.
 */
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: authTokenTypeEnum('type').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type AuthTokenRow = typeof authTokens.$inferSelect;
export type NewAuthTokenRow = typeof authTokens.$inferInsert;
