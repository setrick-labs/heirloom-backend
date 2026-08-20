import {
  pgTable,
  uuid,
  text,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { commentTypeEnum, contentTargetTypeEnum } from './enums';
import { media } from './media';
import { users } from './users';

export const comments = pgTable(
  'comments',
  {
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
    /**
     * The comment this one replies to, or null for a top-level comment.
     *
     * Exactly one level deep: a reply always hangs off a top-level comment,
     * never off another reply. Enforced in the service, because a nested
     * thread that can grow without limit is a different product from the one
     * this is — and deleting a parent takes its replies with it, since a
     * reply to nothing is not readable.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    ...timestamps,
  },
  (table) => [
    index('comments_target_type_target_id_idx').on(
      table.targetType,
      table.targetId,
    ),
    index('comments_parent_id_idx').on(table.parentId),
  ],
);

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
