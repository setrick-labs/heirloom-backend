import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/**
 * Mirrors frontend/heirloom-mobile/src/schemas/journey.schema.ts field-for-field,
 * plus `visibilityType`, which the backend's database/schema/journeys.ts requires
 * but predates that field on the mobile side — add it there too when you touch
 * the mobile schema next.
 */
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
  milestoneCount: z.number().int().min(0).default(0),
  createdBy: idSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Journey = z.infer<typeof journeySchema>;

export const createJourneyInputSchema = journeySchema.pick({
  familyId: true,
  title: true,
  description: true,
  startDate: true,
  endDate: true,
  visibilityType: true,
});
export type CreateJourneyInput = z.infer<typeof createJourneyInputSchema>;

export const updateJourneyInputSchema = journeySchema
  .pick({
    title: true,
    description: true,
    coverImageUrl: true,
    startDate: true,
    endDate: true,
    visibilityType: true,
  })
  .partial();
export type UpdateJourneyInput = z.infer<typeof updateJourneyInputSchema>;

export const addJourneyMemberInputSchema = z.object({
  userId: idSchema,
});
export type AddJourneyMemberInput = z.infer<typeof addJourneyMemberInputSchema>;
