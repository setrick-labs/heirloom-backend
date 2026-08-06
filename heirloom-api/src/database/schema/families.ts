import { pgTable, uuid, varchar, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './users';

export const families = pgTable('families', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 500 }),
  coverImageUrl: text('cover_image_url'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
});

export type FamilyRow = typeof families.$inferSelect;
export type NewFamilyRow = typeof families.$inferInsert;
