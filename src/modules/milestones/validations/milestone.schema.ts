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
  /** Optional cover for the place. Presigned on read when uploaded in-app. */
  coverImageUrl: z.url().nullable().optional(),
  mediaIds: z.array(idSchema).default([]),
  /**
   * Up to three thumbnail URLs, newest first — enough for the timeline card's
   * peek without it fetching each media row itself. Deliberately capped
   * server-side: the card shows three and a "+N more", so sending forty URLs
   * would be forty presigns nobody looks at.
   */
  previewThumbnails: z.array(z.string()).default([]),
  /** Sum of reactions across all of this milestone's media (Milestones spec Section 5/9). */
  reactionCount: z.number().int().min(0).default(0),
  /** "12 memories" on Screen 24's header — always equals mediaIds.length. */
  memoryCount: z.number().int().min(0).default(0),
  /** "3 contributors" on Screen 24 — distinct people who added a Memory here. */
  contributorCount: z.number().int().min(0).default(0),
  /** Memories from other people since this viewer last opened it — the timeline card's badge (Screen 20). */
  unreadCount: z.number().int().min(0).default(0),
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

/**
 * Editing a stop (Screen 24's ••• > Edit Place). Every field optional so the
 * same endpoint covers a rename, a date correction, or both — but at least
 * one must be present, or the request is a no-op the client didn't mean.
 *
 * `description` and `location` are nullable rather than merely optional:
 * `null` clears them, `undefined` leaves them alone. Omitting that
 * distinction would make a cleared location indistinguishable from an
 * untouched one.
 */
export const renameMilestoneInputSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    date: isoDateTimeSchema.optional(),
    location: z.string().max(200).nullable().optional(),
    /**
     * Key from POST /media/cover-upload-url with scope 'milestone'. Null
     * clears the cover; undefined leaves it alone, same as the fields above.
     */
    coverStorageKey: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  });
export type RenameMilestoneInput = z.infer<typeof renameMilestoneInputSchema>;
