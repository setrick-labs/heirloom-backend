import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import { userRoleSchema } from '../../users/validations/user.schema';

/** A roster entry, already name-resolved for the requesting viewer (alias if set, else display name). */
export const familyMemberViewSchema = z.object({
  userId: idSchema,
  role: userRoleSchema,
  joinedAt: isoDateTimeSchema,
  displayName: z.string(),
  resolvedName: z.string(),
  hasAlias: z.boolean(),
});
export type FamilyMemberView = z.infer<typeof familyMemberViewSchema>;

export const setAliasInputSchema = z.object({
  nickname: z.string().min(1).max(120),
});
export type SetAliasInput = z.infer<typeof setAliasInputSchema>;
