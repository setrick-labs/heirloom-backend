import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';
import { userRoleSchema } from '../../users/validations/user.schema';

/**
 * A roster entry, already name-resolved for the requesting viewer.
 * See shared/utils/display-name.util.ts for the alias > nickname > name
 * precedence; `nameSource` tells the client which one won, so Screen 34 can
 * pick the right subtitle ("Your name for him…" vs "His own nickname").
 */
export const familyMemberViewSchema = z.object({
  userId: idSchema,
  role: userRoleSchema,
  joinedAt: isoDateTimeSchema,
  /** users.name — the unresolved account name. */
  displayName: z.string(),
  /** The nickname this member chose for this family (Screen 14), or null. */
  nickname: z.string().nullable(),
  resolvedName: z.string(),
  hasAlias: z.boolean(),
  nameSource: z.enum(['alias', 'nickname', 'name']),
});
export type FamilyMemberView = z.infer<typeof familyMemberViewSchema>;

export const setAliasInputSchema = z.object({
  nickname: z.string().min(1).max(120),
});
export type SetAliasInput = z.infer<typeof setAliasInputSchema>;

/**
 * Screen 14 ("What should the family call you?") and Screen 34's own-row
 * "Edit". Public within the family and self-service only — there is no
 * endpoint for setting someone ELSE's nickname, by design; that's what an
 * alias is.
 */
export const setOwnNicknameInputSchema = z.object({
  nickname: z.string().min(1).max(120),
});
export type SetOwnNicknameInput = z.infer<typeof setOwnNicknameInputSchema>;
