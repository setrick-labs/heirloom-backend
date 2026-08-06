import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

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
  caption: z.string().max(500).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().positive().nullable().optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
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
  milestoneId: idSchema,
  type: mediaTypeSchema,
  key: z.string().min(1),
  caption: mediaSchema.shape.caption,
  sizeBytes: mediaSchema.shape.sizeBytes,
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
