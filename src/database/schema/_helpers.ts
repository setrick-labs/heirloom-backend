import { integer, text, timestamp } from 'drizzle-orm/pg-core';

import { mediaProcessingStatusEnum } from './enums';

/** Standard created_at/updated_at pair. updated_at is maintained by the app layer. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};

/**
 * What MediaProcessingService writes back for a stored photo or video — the
 * same columns, with the same meaning, as on `media` (see media.ts for each
 * one). Shared by the Vault tables so a private photo gets a thumbnail and a
 * private video a poster and a streaming copy, exactly like family content.
 * All null until processing finishes, and for audio forever.
 */
export const processedVariants = {
  thumbnailStorageKey: text('thumbnail_storage_key'),
  displayStorageKey: text('display_storage_key'),
  zoomStorageKey: text('zoom_storage_key'),
  posterStorageKey: text('poster_storage_key'),
  blurhash: text('blurhash'),
  processingStatus: mediaProcessingStatusEnum('processing_status'),
  width: integer('width'),
  height: integer('height'),
  durationSeconds: integer('duration_seconds'),
};
