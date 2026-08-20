import { pgTable, uuid, varchar, timestamp, index, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { journeys } from './journeys';
import { users } from './users';

export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    date: timestamp('date', { withTimezone: true }).notNull(),
    location: varchar('location', { length: 200 }),
    // Optional cover for the place — the same two-column split families and
    // journeys use: a key uploaded through the app (presigned fresh on read,
    // because those URLs expire) or a plain URL set directly.
    coverImageUrl: text('cover_image_url'),
    coverStorageKey: text('cover_storage_key'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Soft-delete, same grace-period pattern as journeys.deletedAt.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('milestones_journey_id_idx').on(table.journeyId)],
);

export type MilestoneRow = typeof milestones.$inferSelect;
export type NewMilestoneRow = typeof milestones.$inferInsert;
