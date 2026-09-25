import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/** Enough bars for a comment bubble's strip; anything finer is noise nobody sees. */
export const MAX_WAVEFORM_BARS = 64;

/** Mirrors frontend/heirloom-mobile/src/schemas/media.schema.ts field-for-field. */
export const mediaTypeSchema = z.enum(['image', 'video', 'audio']);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const mediaSchema = z.object({
  id: idSchema,
  familyId: idSchema,
  ownerId: idSchema,
  type: mediaTypeSchema,
  url: z.url(),
  thumbnailUrl: z.url().nullable().optional(),
  /** Sharper copy for pinch-zoom; null when the display variant is all there is. */
  zoomUrl: z.url().nullable().optional(),
  blurhash: z.string().nullable().optional(),
  caption: z.string().max(500).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().positive().nullable().optional(),
  /** Audio only — see database/schema/media.ts. */
  waveform: z
    .array(z.number().min(0).max(1))
    .max(MAX_WAVEFORM_BARS)
    .nullable()
    .optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
  /** Backs Screen 24's `💬 4` pill — the only pre-open signal a tile has a discussion. */
  commentCount: z.number().int().min(0).default(0),
  /** Backs the `❤️ 4` pill — the only pre-open signal a tile has been liked. */
  reactionCount: z.number().int().min(0).default(0),
  createdAt: isoDateTimeSchema,
});
export type Media = z.infer<typeof mediaSchema>;

/**
 * Registration step after the client has already uploaded directly to R2
 * using the key handed back by /media/upload-url — so this takes `key`,
 * not `url`. The served `url` in mediaSchema is always resolved server-side
 * (public CDN URL or a fresh presigned download URL), never client-supplied.
 */
export const createMediaInputSchema = z.object({
  familyId: idSchema,
  // Absent for a comment attachment (MediaService.create branches on this) —
  // everything else about registration is identical either way.
  milestoneId: idSchema.optional(),
  type: mediaTypeSchema,
  key: z.string().min(1),
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
  // Both audio-only and client-measured: the recorder knows the length and
  // the levels exactly, and the server has no cheap way to recover either.
  // Ignored for images/video (MediaService.create).
  durationSeconds: mediaSchema.shape.durationSeconds,
  waveform: mediaSchema.shape.waveform,
});
export type CreateMediaInput = z.infer<typeof createMediaInputSchema>;

export const requestUploadUrlInputSchema = z.object({
  familyId: idSchema,
  journeyId: idSchema,
  milestoneId: idSchema,
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlInputSchema>;

/**
 * Presigned PUT for a photo attached directly to a comment — no Milestone
 * or Journey involved, so this asks for neither. Family membership is the
 * whole access check (MediaService.requestCommentAttachmentUploadUrl).
 */
export const requestCommentAttachmentUploadUrlInputSchema = z.object({
  familyId: idSchema,
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type RequestCommentAttachmentUploadUrlInput = z.infer<
  typeof requestCommentAttachmentUploadUrlInputSchema
>;

/**
 * Cover photos for a Family (Screen 12) or a Journey (Screen 19). Separate
 * from requestUploadUrlInputSchema because a cover belongs to no milestone
 * and so can't satisfy that schema's journeyId/milestoneId requirements.
 *
 * `targetId` may name a row that doesn't exist yet — both screens let you
 * pick the photo before submitting the form that creates the thing — so
 * this only namespaces a storage key; it is never a row lookup. The
 * returned key is bound to the real row afterwards, by the create/update
 * call that accepts `coverStorageKey`.
 */
export const requestCoverUploadUrlInputSchema = z.object({
  scope: z.enum(['family', 'journey', 'user', 'milestone']),
  targetId: idSchema,
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
export type RequestCoverUploadUrlInput = z.infer<
  typeof requestCoverUploadUrlInputSchema
>;
