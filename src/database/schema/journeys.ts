import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { journeyVisibilityEnum } from './enums';
import { families } from './families';
import { users } from './users';

export const journeys = pgTable('journeys', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 120 }).notNull(),
  description: varchar('description', { length: 1000 }),
  coverImageUrl: text('cover_image_url'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  visibilityType: journeyVisibilityEnum('visibility_type')
    .notNull()
    .default('all'),
  // The sole owner (single-owner for v1, see the Journeys functional spec) —
  // exclusively controls rename, visibility, membership, and deletion.
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // Soft-delete, same grace-period pattern as families.deletedAt.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
});

export type JourneyRow = typeof journeys.$inferSelect;
export type NewJourneyRow = typeof journeys.$inferInsert;
