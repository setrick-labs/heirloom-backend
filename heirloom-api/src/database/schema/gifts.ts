import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { families } from './families';
import { media } from './media';
import { users } from './users';

export const gifts = pgTable('gifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  fromUserId: uuid('from_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Nullable = gifted to the whole family rather than one person.
  toUserId: uuid('to_user_id').references(() => users.id, {
    onDelete: 'cascade',
  }),
  title: varchar('title', { length: 120 }).notNull(),
  message: varchar('message', { length: 2000 }),
  mediaId: uuid('media_id').references(() => media.id, {
    onDelete: 'set null',
  }),
  unlockDate: timestamp('unlock_date', { withTimezone: true }),
  isUnlocked: boolean('is_unlocked').notNull().default(false),
  ...timestamps,
});

export type GiftRow = typeof gifts.$inferSelect;
export type NewGiftRow = typeof gifts.$inferInsert;
