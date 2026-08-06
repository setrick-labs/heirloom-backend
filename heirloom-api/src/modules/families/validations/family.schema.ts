import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import { userRoleSchema } from '../../users/validations/user.schema';

/** Mirrors frontend/heirloom-mobile/src/schemas/family.schema.ts field-for-field. */
export const familyMemberSchema = z.object({
  userId: idSchema,
  familyId: idSchema,
  role: userRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type FamilyMember = z.infer<typeof familyMemberSchema>;

export const familySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  coverImageUrl: z.url().nullable().optional(),
  ownerId: idSchema,
  memberCount: z.number().int().min(0).default(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Family = z.infer<typeof familySchema>;

export const createFamilyInputSchema = familySchema.pick({
  name: true,
  description: true,
});
export type CreateFamilyInput = z.infer<typeof createFamilyInputSchema>;

export const updateFamilyInputSchema = familySchema
  .pick({ name: true, description: true, coverImageUrl: true })
  .partial();
export type UpdateFamilyInput = z.infer<typeof updateFamilyInputSchema>;

export const inviteFamilyMemberInputSchema = z.object({
  email: z.email(),
  role: userRoleSchema.exclude(['owner']).default('member'),
});
export type InviteFamilyMemberInput = z.infer<
  typeof inviteFamilyMemberInputSchema
>;
