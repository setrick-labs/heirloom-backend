import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { journeyVisibilityEnum } from './enums';
import { families } from './families';
import { users } from './users';

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    // An externally-hosted cover URL, if one was ever set directly.
    // Prefer coverStorageKey below for anything uploaded through the app.
    coverImageUrl: text('cover_image_url'),
    // R2 object key for a cover uploaded via the app (Screen 19's "add a
    // cover photo"). A key, not a URL, for the same reason media.storageKey
    // is: the served URL is presigned and expires, so it has to be resolved
    // fresh on every read rather than persisted.
    coverStorageKey: text('cover_storage_key'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    visibilityType: journeyVisibilityEnum('visibility_type')
      .notNull()
      .default('all'),
    // The sole owner (single-owner for v1, see the Journeys functional spec) —
    // exclusively controls rename, visibility, membership, and deletion.
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Soft-delete, same grace-period pattern as families.deletedAt.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('journeys_family_id_idx').on(table.familyId)],
);

export type JourneyRow = typeof journeys.$inferSelect;
export type NewJourneyRow = typeof journeys.$inferInsert;
