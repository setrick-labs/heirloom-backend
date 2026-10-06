import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { families } from './families';
import { users } from './users';

/**
 * Invite by email — the single-use sibling of family_invites' shared 6-digit
 * code. Bound to one address: only an account whose verified email matches
 * can accept it, so a forwarded link is useless to whoever it was forwarded
 * to.
 *
 * `tokenHash` is the SHA-256 of a 32-byte opaque token carried in the link;
 * the raw token only ever exists in the email. Resending mints a new token
 * on the same row (the old link stops working), which is why pending rows
 * are unique per (family, email).
 */
export const familyEmailInvites = pgTable(
  'family_email_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    /** Lowercased at write time. */
    email: varchar('email', { length: 255 }).notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // The link resolves the invite from the token alone.
    uniqueIndex('family_email_invites_token_hash_idx').on(table.tokenHash),
    // One live invite per person per family; accepted/revoked rows are history.
    uniqueIndex('family_email_invites_pending_idx')
      .on(table.familyId, table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    // "Invites waiting for this address" at sign-in / verification.
    index('family_email_invites_email_idx').on(table.email),
  ],
);

export type FamilyEmailInviteRow = typeof familyEmailInvites.$inferSelect;
