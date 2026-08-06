import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import { userRoleSchema } from '../../users/validations/user.schema';

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
  // Set only while pending deletion (grace period) — Section 7.
  deletedAt: isoDateTimeSchema.nullable().optional(),
  purgeAt: isoDateTimeSchema.nullable().optional(),
});
export type Family = z.infer<typeof familySchema>;

export const createFamilyInputSchema = familySchema.pick({
  name: true,
  description: true,
});
export type CreateFamilyInput = z.infer<typeof createFamilyInputSchema>;

export const renameFamilyInputSchema = z.object({
  name: z.string().min(1).max(120),
});
export type RenameFamilyInput = z.infer<typeof renameFamilyInputSchema>;

/** Spec: "typing the family's name to confirm" — checked server-side too, not just a client UX gate. */
export const deleteFamilyInputSchema = z.object({
  confirmName: z.string().min(1),
});
export type DeleteFamilyInput = z.infer<typeof deleteFamilyInputSchema>;
