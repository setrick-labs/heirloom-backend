import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { journeys } from './journeys';
import { users } from './users';

export const milestones = pgTable('milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  journeyId: uuid('journey_id')
    .notNull()
    .references(() => journeys.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 120 }).notNull(),
  description: varchar('description', { length: 1000 }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  location: varchar('location', { length: 200 }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
});

export type MilestoneRow = typeof milestones.$inferSelect;
export type NewMilestoneRow = typeof milestones.$inferInsert;
