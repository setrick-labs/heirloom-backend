import { pgTable, uuid, timestamp, unique } from 'drizzle-orm/pg-core';

import { journeys } from './journeys';
import { users } from './users';

/** Grants a user visibility into a journey whose visibility_type is 'selected'. */
export const journeyMembers = pgTable(
  'journey_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('journey_members_journey_user_unique').on(
      table.journeyId,
      table.userId,
    ),
  ],
);

export type JourneyMemberRow = typeof journeyMembers.$inferSelect;
export type NewJourneyMemberRow = typeof journeyMembers.$inferInsert;
