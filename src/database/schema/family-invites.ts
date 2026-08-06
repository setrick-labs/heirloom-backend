import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

import { families } from './families';
import { users } from './users';

/**
 * A 6-digit invite code (or the link built from it) — reusable by multiple
 * people until it expires, not single-use. Generating a fresh code for a
 * family should revoke the family's previous one (see families.service.ts).
 */
export const familyInvites = pgTable('family_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 6 }).notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type FamilyInviteRow = typeof familyInvites.$inferSelect;
export type NewFamilyInviteRow = typeof familyInvites.$inferInsert;
