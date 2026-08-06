import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { timestamps } from './_helpers';
import { userStatusEnum } from './enums';

// Deliberately NOT importing `families` here (users <-> families would be a
// circular table reference). Drizzle's generic type inference silently
// collapses to `any` across the whole schema barrel when two tables import
// each other for FK types — confirmed empirically, not a style preference.
// The FK constraint itself still exists in the DB; it's just added by hand
// in the migration SQL (see database/migrations) instead of declared here.

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Either email or phone (or both) must be set — enforced by the check
    // constraint below and by signUpInputSchema at the API layer.
    email: varchar('email', { length: 255 }).unique(),
    phone: varchar('phone', { length: 32 }).unique(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    avatarUrl: text('avatar_url'),
    bio: varchar('bio', { length: 500 }),
    status: userStatusEnum('status').notNull().default('pending'),

    // Which family workspace to resume into on sign-in (Section 6). Nullable:
    // a brand-new verified account has none yet until create/join family.
    // No .references() here — see the import comment above; the FK
    // constraint is added by hand in the migration SQL instead.
    activeFamilyId: uuid('active_family_id'),

    // Per-identifier brute-force throttling (Section 2).
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    // JWTs with `iat` before this are rejected — how a password reset
    // invalidates every other active session without a token blacklist.
    sessionsInvalidatedAt: timestamp('sessions_invalidated_at', {
      withTimezone: true,
    }),

    // Private Vault spec Section 1: a second, independent lock — null means
    // the Vault has never been set up yet. Deliberately distinct from
    // passwordHash above (enforced at the API layer, not the DB) and never
    // used by the main sign-in flow.
    vaultPasswordHash: text('vault_password_hash'),
    // Same "reject any vault token issued before this" pattern as
    // sessionsInvalidatedAt above, bumped on vault password change/recovery
    // (Section 6) so an old vault session can't outlive a credential reset.
    vaultSessionsInvalidatedAt: timestamp('vault_sessions_invalidated_at', {
      withTimezone: true,
    }),

    ...timestamps,
  },
  (table) => [
    check(
      'users_email_or_phone_required',
      sql`${table.email} IS NOT NULL OR ${table.phone} IS NOT NULL`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
