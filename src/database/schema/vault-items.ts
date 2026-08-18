import {
  bigint,
  pgTable,
  uuid,
  text,
  varchar,
  index,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { mediaTypeEnum } from './enums';
import { users } from './users';

/**
 * Private Vault spec Section 4: person-scoped, not family-scoped — one
 * Vault per person, full stop. No familyId here, deliberately, even though
 * every other content table in this schema has one.
 *
 * Section 5: also deliberately its own table with its own storage-key
 * column, rather than a row in `media` (which is built for family-shared
 * content, keyed by familyId/journeyId/milestoneId). Vault items never pass
 * through the same code path as shared content — full storage-level
 * encryption is flagged as a follow-up, but this keeps the two completely
 * separate at the data-model level today, not just gated by an app-level
 * permission check on shared rows.
 */
export const vaultItems = pgTable(
  'vault_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: mediaTypeEnum('type').notNull(),
    storageKey: text('storage_key').notNull(),
    caption: varchar('caption', { length: 500 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    ...timestamps,
  },
  (table) => [
    // The Vault list is always "everything I own, newest first" — the only
    // way this table is ever read in bulk.
    index('vault_items_owner_id_idx').on(table.ownerId),
  ],
);

export type VaultItemRow = typeof vaultItems.$inferSelect;
export type NewVaultItemRow = typeof vaultItems.$inferInsert;
