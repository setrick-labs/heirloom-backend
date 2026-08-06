import { pgTable, uuid, varchar, unique } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { families } from './families';
import { users } from './users';

/**
 * Per-viewer private nickname scoped to a family: `viewerUserId` is the only
 * person who ever sees the nickname they've given to `subjectUserId`.
 */
export const aliases = pgTable(
  'aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    subjectUserId: uuid('subject_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewerUserId: uuid('viewer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: varchar('nickname', { length: 120 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique('aliases_family_subject_viewer_unique').on(
      table.familyId,
      table.subjectUserId,
      table.viewerUserId,
    ),
  ],
);

export type AliasRow = typeof aliases.$inferSelect;
export type NewAliasRow = typeof aliases.$inferInsert;
