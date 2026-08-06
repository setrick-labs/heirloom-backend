import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/** Mirrors frontend/heirloom-mobile/src/schemas/gift.schema.ts field-for-field. */
export const giftSchema = z.object({
  id: idSchema,
  familyId: idSchema,
  fromUserId: idSchema,
  toUserId: idSchema.nullable().optional(),
  title: z.string().min(1).max(120),
  message: z.string().max(2000).nullable().optional(),
  mediaId: idSchema.nullable().optional(),
  unlockDate: isoDateTimeSchema.nullable().optional(),
  isUnlocked: z.boolean().default(false),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Gift = z.infer<typeof giftSchema>;

export const createGiftInputSchema = giftSchema.pick({
  familyId: true,
  toUserId: true,
  title: true,
  message: true,
  mediaId: true,
  unlockDate: true,
});
export type CreateGiftInput = z.infer<typeof createGiftInputSchema>;
