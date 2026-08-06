import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import {
  mediaSchema,
  mediaTypeSchema,
} from '../../media/validations/media.schema';

/** Mirrors frontend/heirloom-mobile/src/schemas/milestone.schema.ts field-for-field. */
export const milestoneSchema = z.object({
  id: idSchema,
  journeyId: idSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  date: isoDateTimeSchema,
  location: z.string().max(200).nullable().optional(),
  mediaIds: z.array(idSchema).default([]),
  /** Sum of reactions across all of this milestone's media (Milestones spec Section 5/9). */
  reactionCount: z.number().int().min(0).default(0),
  /**
   * Latest media/comment/reaction timestamp contributed by someone OTHER
   * than the viewer — drives the unread badge (Section 7: a person's own
   * additions never increment their own badge). Null if nobody but the
   * viewer has ever touched this milestone.
   */
  lastOtherActivityAt: isoDateTimeSchema.nullable(),
  createdBy: idSchema,
  /** Creator or the journey's owner — the only two who can rename/delete this milestone (Section 8). */
  canManage: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  // Set only while pending deletion (grace period).
  deletedAt: isoDateTimeSchema.nullable().optional(),
  purgeAt: isoDateTimeSchema.nullable().optional(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

/**
 * Section 1: a Milestone isn't a meaningful unit without its first photo/
 * video, so creation carries it atomically rather than allowing a
 * title-only placeholder. `id` is client-generated (a v4 uuid) because the
 * client needs it up front anyway, to scope the presigned-upload-url
 * request that has to happen before this call.
 */
export const createMilestoneInputSchema = milestoneSchema
  .pick({
    id: true,
    journeyId: true,
    title: true,
    description: true,
    date: true,
    location: true,
  })
  .partial({ title: true, date: true })
  .extend({
    media: z.object({
      key: z.string().min(1),
      type: mediaTypeSchema,
      caption: mediaSchema.shape.caption,
      sizeBytes: mediaSchema.shape.sizeBytes,
    }),
  });
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

export const renameMilestoneInputSchema = z.object({
  title: z.string().min(1).max(120),
});
export type RenameMilestoneInput = z.infer<typeof renameMilestoneInputSchema>;
