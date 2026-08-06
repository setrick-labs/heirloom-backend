import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
} from 'drizzle-orm/pg-core';

import { mediaTypeEnum } from './enums';
import { families } from './families';
import { milestones } from './milestones';
import { users } from './users';

export const media = pgTable('media', {
  id: uuid('id').defaultRandom().primaryKey(),
  familyId: uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  milestoneId: uuid('milestone_id').references(() => milestones.id, {
    onDelete: 'set null',
  }),
  type: mediaTypeEnum('type').notNull(),
  // R2 object key (see shared/services/storage-keys.util.ts), not a URL —
  // the served URL is always resolved fresh (public CDN or presigned),
  // never stored, since presigned URLs expire.
  storageKey: text('storage_key').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  caption: varchar('caption', { length: 500 }),
  width: integer('width'),
  height: integer('height'),
  durationSeconds: integer('duration_seconds'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type MediaRow = typeof media.$inferSelect;
export type NewMediaRow = typeof media.$inferInsert;
