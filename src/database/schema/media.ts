import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

import { mediaProcessingStatusEnum, mediaTypeEnum } from './enums';
import { families } from './families';
import { milestones } from './milestones';
import { users } from './users';

export const media = pgTable(
  'media',
  {
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
    // Resized WebP variants generated post-upload by MediaProcessingService —
    // R2 object keys, same resolve-fresh-URL rule as storageKey above. Null
    // until processing finishes (or forever, for non-image media/failures);
    // toDto() falls back to the original storageKey when unset.
    thumbnailStorageKey: text('thumbnail_storage_key'),
    displayStorageKey: text('display_storage_key'),
    // Compact base83 blurhash string — decoded client-side into an instant
    // placeholder while the real image loads, instead of a blank tile.
    blurhash: text('blurhash'),
    // Null for non-image media (never processed). See enums.ts for the
    // pending/done/failed lifecycle.
    processingStatus: mediaProcessingStatusEnum('processing_status'),
    caption: varchar('caption', { length: 500 }),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('media_family_id_idx').on(table.familyId),
    index('media_milestone_id_idx').on(table.milestoneId),
  ],
);

export type MediaRow = typeof media.$inferSelect;
export type NewMediaRow = typeof media.$inferInsert;
