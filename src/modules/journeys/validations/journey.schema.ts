import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

export const journeyVisibilitySchema = z.enum(['all', 'selected']);
export type JourneyVisibility = z.infer<typeof journeyVisibilitySchema>;

export const journeySchema = z.object({
  id: idSchema,
  familyId: idSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  coverImageUrl: z.url().nullable().optional(),
  startDate: isoDateTimeSchema.nullable().optional(),
  endDate: isoDateTimeSchema.nullable().optional(),
  visibilityType: journeyVisibilitySchema.default('all'),
  /** "6 places" on the Home card (Screen 17). */
  milestoneCount: z.number().int().min(0).default(0),
  /** Total Memories in the journey — Screen 48 fires a celebration every 10th. */
  memoryCount: z.number().int().min(0).default(0),
  /** "4 can see this" (Screens 19/20) — everyone with visibility, owner included. */
  memberCount: z.number().int().min(0).default(0),
  /** Unseen Memories from other people since this viewer last opened it — the cover badge on Screen 17. */
  unreadCount: z.number().int().min(0).default(0),
  /** A scheduled, uncancelled gift exists — Screen 38's gift icon on the journey. */
  giftScheduled: z.boolean().default(false),
  /** Latest milestone activity, or the journey's own createdAt if it has none yet — drives list sort order. */
  lastActivityAt: isoDateTimeSchema,
  createdBy: idSchema,
  /** Computed for the requesting viewer — single-owner model, see Section 4/9. */
  isOwner: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  // Set only while pending deletion (grace period).
  deletedAt: isoDateTimeSchema.nullable().optional(),
  purgeAt: isoDateTimeSchema.nullable().optional(),
});
export type Journey = z.infer<typeof journeySchema>;

const createJourneyBaseFields = {
  familyId: idSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  startDate: isoDateTimeSchema.nullable().optional(),
  endDate: isoDateTimeSchema.nullable().optional(),
  // Screen 19 lets you attach the cover before submitting, so the key is
  // already uploaded by the time this call happens.
  coverStorageKey: z.string().min(1).nullable().optional(),
};

/**
 * 'selected' requires the initial member list up front (Section 1/2) — 'all'
 * doesn't take one at all, since All Family access is computed dynamically
 * from current family membership, not a stored list.
 */
export const createJourneyInputSchema = z.discriminatedUnion('visibilityType', [
  z.object({ ...createJourneyBaseFields, visibilityType: z.literal('all') }),
  z.object({
    ...createJourneyBaseFields,
    visibilityType: z.literal('selected'),
    memberUserIds: z.array(idSchema).min(1, 'Select at least one member'),
  }),
]);
export type CreateJourneyInput = z.infer<typeof createJourneyInputSchema>;

/**
 * Title and/or cover photo. The cover arrives as a storage key already
 * uploaded via POST /media/cover-upload-url (Screen 19's "add a cover
 * photo") — a key, not a URL, since the served URL is presigned and
 * expires. `null` clears an existing cover.
 */
export const updateJourneyInputSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    coverStorageKey: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.coverStorageKey !== undefined,
    { message: 'Provide a title or a cover photo to update' },
  );
export type UpdateJourneyInput = z.infer<typeof updateJourneyInputSchema>;

/**
 * Section 3: switching to 'selected' always carries an explicit member list
 * (the mobile client pre-fills it with "everyone except the excluded
 * person" when converting from 'all', but the API contract is just a list).
 */
export const setVisibilityInputSchema = z.discriminatedUnion('visibilityType', [
  z.object({ visibilityType: z.literal('all') }),
  z.object({
    visibilityType: z.literal('selected'),
    memberUserIds: z.array(idSchema).min(1, 'Select at least one member'),
  }),
]);
export type SetVisibilityInput = z.infer<typeof setVisibilityInputSchema>;

export const addJourneyMembersInputSchema = z.object({
  userIds: z.array(idSchema).min(1),
});
export type AddJourneyMembersInput = z.infer<
  typeof addJourneyMembersInputSchema
>;
