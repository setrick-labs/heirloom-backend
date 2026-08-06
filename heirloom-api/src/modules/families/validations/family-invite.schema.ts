import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

export const familyInviteSchema = z.object({
  code: z.string().length(6),
  link: z.url().nullable(),
  expiresAt: isoDateTimeSchema,
});
export type FamilyInvite = z.infer<typeof familyInviteSchema>;

export const familyInvitePreviewSchema = z.object({
  familyId: idSchema,
  familyName: z.string(),
  memberCount: z.number().int().min(0),
  alreadyMember: z.boolean(),
});
export type FamilyInvitePreview = z.infer<typeof familyInvitePreviewSchema>;

export const joinFamilyInputSchema = z.object({
  code: z.string().length(6),
});
export type JoinFamilyInput = z.infer<typeof joinFamilyInputSchema>;
