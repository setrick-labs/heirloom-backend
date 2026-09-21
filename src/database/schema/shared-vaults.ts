import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import {
  mediaTypeEnum,
  sharedVaultDeletionStatusEnum,
  sharedVaultMemberRoleEnum,
  sharedVaultMemberStatusEnum,
} from './enums';
import { families } from './families';
import { users } from './users';

/**
 * A private album shared by a few chosen members of one family — the
 * personal Vault's pattern (its own passcode, its own short-lived token, its
 * own table and storage prefix) extended to more than one person.
 *
 * Family-scoped, unlike `vault_items`: members are always picked from one
 * family, which is what makes "who can I add?" answerable without inventing
 * a second invitation system.
 */
export const sharedVaults = pgTable(
  'shared_vaults',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [index('shared_vaults_family_id_idx').on(table.familyId)],
);

/**
 * One row per person per vault. The passcode lives here rather than on the
 * vault: every member chooses their own, so nobody ever has to pass a secret
 * to anyone else, and changing yours touches nobody else's. Lockout and
 * session invalidation are per row for the same reason — one person's
 * fumbled passcode must not lock the others out.
 */
export const sharedVaultMembers = pgTable(
  'shared_vault_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => sharedVaults.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: sharedVaultMemberRoleEnum('role').notNull().default('member'),
    status: sharedVaultMemberStatusEnum('status').notNull().default('invited'),
    invitedBy: uuid('invited_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Null until the invite is accepted — an invitee has no way in yet. */
    passcodeHash: text('passcode_hash'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Bumped on passcode change/recovery; older tokens stop working. */
    sessionsInvalidatedAt: timestamp('sessions_invalidated_at', {
      withTimezone: true,
    }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('shared_vault_members_vault_user_unique').on(
      table.vaultId,
      table.userId,
    ),
    // "Which shared vaults am I in" — the list screen's only query shape.
    index('shared_vault_members_user_id_idx').on(table.userId),
  ],
);

export const sharedVaultItems = pgTable(
  'shared_vault_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => sharedVaults.id, { onDelete: 'cascade' }),
    /** Charged against this person's storage; null once they're deleted. */
    uploaderId: uuid('uploader_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    type: mediaTypeEnum('type').notNull(),
    storageKey: text('storage_key').notNull(),
    caption: varchar('caption', { length: 500 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    ...timestamps,
  },
  (table) => [
    index('shared_vault_items_vault_id_idx').on(table.vaultId),
    index('shared_vault_items_uploader_id_idx').on(table.uploaderId),
  ],
);

/**
 * Mutual delete: removing an item (`itemId` set) or the whole vault
 * (`itemId` null) needs every other active member to agree. Approval is
 * derived from the votes against the *current* membership, never from a
 * count frozen at request time — so someone leaving can't strand a request
 * waiting on a vote that will never come.
 */
export const sharedVaultDeletionRequests = pgTable(
  'shared_vault_deletion_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => sharedVaults.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => sharedVaultItems.id, {
      onDelete: 'cascade',
    }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: sharedVaultDeletionStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('shared_vault_deletion_requests_vault_id_idx').on(table.vaultId),
  ],
);

export const sharedVaultDeletionVotes = pgTable(
  'shared_vault_deletion_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => sharedVaultDeletionRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    approve: boolean('approve').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('shared_vault_deletion_votes_request_user_unique').on(
      table.requestId,
      table.userId,
    ),
  ],
);

export type SharedVaultRow = typeof sharedVaults.$inferSelect;
export type SharedVaultMemberRow = typeof sharedVaultMembers.$inferSelect;
export type SharedVaultItemRow = typeof sharedVaultItems.$inferSelect;
export type SharedVaultDeletionRequestRow =
  typeof sharedVaultDeletionRequests.$inferSelect;
