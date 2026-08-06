import { pgTable, uuid, varchar, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { families } from './families';
import { media } from './media';
import { users } from './users';

/** Private, biometric-gated items — only ownerId can ever list/unlock these. */
export const vaultItems = pgTable('vault_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').references(() => media.id, {
    onDelete: 'set null',
  }),
  title: varchar('title', { length: 120 }).notNull(),
  note: text('note'),
  ...timestamps,
});

export type VaultItemRow = typeof vaultItems.$inferSelect;
export type NewVaultItemRow = typeof vaultItems.$inferInsert;
