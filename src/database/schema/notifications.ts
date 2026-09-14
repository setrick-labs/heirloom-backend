import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

import { contentTargetTypeEnum, notificationTypeEnum } from './enums';
import { media } from './media';
import { users } from './users';

/**
 * The in-app notification bell's feed — a durable, browsable record of
 * "someone commented/reacted on your memory," distinct from `NotificationService`
 * (shared/services/notification.service.ts), which only ever fires outbound
 * push/email and writes nothing. A row here is written alongside that push,
 * not instead of it: push is what reaches someone whose app is backgrounded,
 * this is what lets them browse the history once they open the bell.
 *
 * `title`/`body` are precomputed at write time from the same copy the push
 * notification uses (see push-notification.template.ts) rather than derived
 * at read time — the actor's name or the comment's quoted text could change
 * or disappear later, and a notification should keep reading the way it did
 * when it arrived.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    // Polymorphic association, same convention as comments/reactions — no
    // DB-level FK on target_id.
    targetType: contentTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    // Nullable and separate from targetId: today every notification is a
    // comment/reaction on a media target, so this always mirrors targetId,
    // but it's named for what it's for (the photo viewer deep link) rather
    // than assumed identical to a polymorphic column that may not always be
    // 'media' if this ever covers a milestone-level comment.
    mediaId: uuid('media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 280 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    // The bell's list: newest first, for one recipient.
    index('notifications_recipient_created_idx').on(
      table.recipientId,
      table.createdAt,
    ),
    // The unread-count badge: `WHERE recipient_id = ? AND read_at IS NULL`.
    index('notifications_recipient_read_idx').on(
      table.recipientId,
      table.readAt,
    ),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
