import { pgTable, uuid, timestamp, index, unique } from 'drizzle-orm/pg-core';

import { viewTargetTypeEnum } from './enums';
import { users } from './users';

/**
 * Per-user "I have seen this up to here" watermark, backing the unread
 * counts the flow renders as a numeric badge — the `7` on a Journey cover
 * (Screen 17) and the `3` on a Milestone card (Screen 20).
 *
 * This is deliberately server-side. The app previously tracked the same
 * thing in a device-local zustand store, which can only ever answer "is
 * there anything new" on one device; a *count* that survives reinstalling
 * the app or signing in on a second phone needs the watermark to live next
 * to the content it refers to.
 *
 * Polymorphic on (targetType, targetId), same no-DB-level-FK convention as
 * comments/reactions — target_id points at journeys.id or milestones.id
 * depending on target_type. Rows are left behind when their target is
 * deleted; they're harmless (nothing joins from this table outward) and
 * cheaper than a polymorphic cascade.
 */
export const contentViews = pgTable(
  'content_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: viewTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /**
     * Everything created after this instant, by someone other than this
     * user, counts as unread. Monotonic by construction — markSeen only
     * ever moves it forward (see views.service.ts), so a stale request
     * arriving late can't un-read something.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('content_views_user_target_unique').on(
      table.userId,
      table.targetType,
      table.targetId,
    ),
    // Every unread-count query starts from "this viewer's watermarks for
    // these N targets", so the viewer+type pair leads the index.
    index('content_views_user_target_type_idx').on(
      table.userId,
      table.targetType,
    ),
  ],
);

export type ContentViewRow = typeof contentViews.$inferSelect;
export type NewContentViewRow = typeof contentViews.$inferInsert;
