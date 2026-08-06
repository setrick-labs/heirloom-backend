import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { commentTypeEnum, contentTargetTypeEnum } from './enums';
import { media } from './media';
import { users } from './users';

export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Polymorphic association (no DB-level FK — target_id may point at
  // milestones.id or media.id depending on target_type).
  targetType: contentTargetTypeEnum('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // 'version' is how "add your version" reuses this table instead of a
  // separate one: it's a comment_type, not a target_type.
  type: commentTypeEnum('type').notNull().default('text'),
  body: text('body'),
  mediaId: uuid('media_id').references(() => media.id, {
    onDelete: 'set null',
  }),
  ...timestamps,
});

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
