import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './users';

export const families = pgTable('families', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 500 }),
  // See journeys.coverImageUrl/coverStorageKey — same split, same reason.
  coverImageUrl: text('cover_image_url'),
  coverStorageKey: text('cover_storage_key'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // Soft-delete: set = pending deletion (grace period), inaccessible to
  // everyone including the initiating admin except via the direct
  // cancel-deletion action. No purge job exists yet — rows past their grace
  // period just stay soft-deleted until one is built.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
});

export type FamilyRow = typeof families.$inferSelect;
export type NewFamilyRow = typeof families.$inferInsert;
