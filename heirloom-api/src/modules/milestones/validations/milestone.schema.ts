import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/** Mirrors frontend/heirloom-mobile/src/schemas/milestone.schema.ts field-for-field. */
export const milestoneSchema = z.object({
  id: idSchema,
  journeyId: idSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  date: isoDateTimeSchema,
  location: z.string().max(200).nullable().optional(),
  mediaIds: z.array(idSchema).default([]),
  createdBy: idSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const createMilestoneInputSchema = milestoneSchema.pick({
  journeyId: true,
  title: true,
  description: true,
  date: true,
  location: true,
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

export const updateMilestoneInputSchema = milestoneSchema
  .pick({ title: true, description: true, date: true, location: true })
  .partial();
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;
