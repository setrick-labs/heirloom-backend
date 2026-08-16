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

/**
 * Screen 12 submits a name and, optionally, a cover photo that was already
 * uploaded via POST /media/cover-upload-url — hence a storage key rather
 * than a URL (see families.coverStorageKey). Both fields are optional so
 * the same endpoint covers "rename only" and "set cover only"; `null`
 * clears an existing cover, which is why it isn't just `.optional()`.
 */
export const updateFamilyInputSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    coverStorageKey: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.coverStorageKey !== undefined,
    { message: 'Provide a name or a cover photo to update' },
  );
export type UpdateFamilyInput = z.infer<typeof updateFamilyInputSchema>;

/** Spec: "typing the family's name to confirm" — checked server-side too, not just a client UX gate. */
export const deleteFamilyInputSchema = z.object({
  confirmName: z.string().min(1),
});
export type DeleteFamilyInput = z.infer<typeof deleteFamilyInputSchema>;
