import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';

import { contentTargetTypeEnum } from './enums';
import { users } from './users';

export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Polymorphic association, same convention as comments.target_type/target_id.
    targetType: contentTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('reactions_target_user_emoji_unique').on(
      table.targetType,
      table.targetId,
      table.userId,
      table.emoji,
    ),
  ],
);

export type ReactionRow = typeof reactions.$inferSelect;
export type NewReactionRow = typeof reactions.$inferInsert;
