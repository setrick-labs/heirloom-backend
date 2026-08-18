import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

import { authTokenTypeEnum } from './enums';
import { users } from './users';

/**
 * Backs both account-verification codes and password-reset tokens — both
 * are "single-use, time-limited, delivered out of band" so one table with
 * a `type` tag avoids duplicating the same lifecycle logic twice.
 * `tokenHash` stores a SHA-256 hash, never the raw code/token.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
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
  },
  (table) => [
    // Verification/reset lookups filter on (user_id, type) together.
    index('auth_tokens_user_id_type_idx').on(table.userId, table.type),
    // confirmPasswordReset resolves the user *from* the token, so it
    // filters on token_hash with no user_id — without this it's a full
    // scan of every token ever issued on each reset attempt.
    index('auth_tokens_token_hash_idx').on(table.tokenHash),
  ],
);

export type AuthTokenRow = typeof authTokens.$inferSelect;
export type NewAuthTokenRow = typeof authTokens.$inferInsert;
