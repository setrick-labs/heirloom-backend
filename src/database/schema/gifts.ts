import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { journeys } from './journeys';
import { users } from './users';

/**
 * Gifting spec: a Journey, scheduled to become visible to someone (who may
 * not have — or ever have had — an account) on a future date. Status is
 * deliberately NOT a stored enum column but derived from these timestamps
 * (see gift.schema.ts's toDto) — "unlocked" happens purely because time
 * passed, not because anything wrote to the row at that moment, and
 * deriving it avoids the row ever being stale relative to the clock.
 */
export const gifts = pgTable('gifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  journeyId: uuid('journey_id')
    .notNull()
    .references(() => journeys.id, { onDelete: 'cascade' }),
  fromUserId: uuid('from_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Always present — the source of truth for matching a recipient, whether
  // or not they have an account yet (Section 3/5).
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  // Resolved lazily: at unlock-sweep time if an account already exists, or
  // at account verification time if they sign up later (even years later —
  // Section 3: "gifts never expire on the recipient's side").
  toUserId: uuid('to_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  message: varchar('message', { length: 2000 }),
  unlockDate: timestamp('unlock_date', { withTimezone: true }).notNull(),
  // Set only via explicit sender cancellation (Section 8) or automatically
  // if the underlying Journey is deleted while still pending (Section 7).
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  // Distinct from "unlocked" — Section 2: did they actually look, not just
  // gain access. Set once, the first time the recipient opens the reveal.
  firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
  // Tracks whether the unlock-sweep has already sent its one-time email, so
  // a recurring sweep never re-sends (see gifts.service.ts's cron).
  inviteSentAt: timestamp('invite_sent_at', { withTimezone: true }),
  unlockNotifiedAt: timestamp('unlock_notified_at', { withTimezone: true }),
  ...timestamps,
});

export type GiftRow = typeof gifts.$inferSelect;
export type NewGiftRow = typeof gifts.$inferInsert;
