import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/**
 * Mirrors frontend/heirloom-mobile/src/schemas/user.schema.ts field-for-field
 * — there's no shared package enforcing this automatically, so keep any
 * change here in sync with the mobile schema by hand.
 */
export const userRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type UserRole = z.infer<typeof userRoleSchema>;

// email/phone are both nullable/optional here (only "at least one" is
// enforced, by signUpInputSchema and a DB check constraint) — this is a
// divergence from the original mobile mirror, which predates phone-based
// signup; update the mobile schema too next time it's touched.
export const userSchema = z.object({
  id: idSchema,
  email: z.email().nullable().optional(),
  phone: z.string().nullable().optional(),
  name: z.string().min(1).max(120),
  avatarUrl: z.url().nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  role: userRoleSchema.default('member'),
  activeFamilyId: idSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

export const createUserInputSchema = userSchema.pick({
  email: true,
  name: true,
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = userSchema
  .pick({ name: true, avatarUrl: true, bio: true })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const switchActiveFamilyInputSchema = z.object({
  familyId: idSchema,
});
export type SwitchActiveFamilyInput = z.infer<
  typeof switchActiveFamilyInputSchema
>;
