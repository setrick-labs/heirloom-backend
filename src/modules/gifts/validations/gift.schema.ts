import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

export const giftStatusSchema = z.enum([
  'pending',
  'unlocked',
  'opened',
  'cancelled',
]);
export type GiftStatus = z.infer<typeof giftStatusSchema>;

export const giftSchema = z.object({
  id: idSchema,
  journeyId: idSchema,
  journeyTitle: z.string(),
  fromUserId: idSchema,
  fromUserName: z.string(),
  recipientEmail: z.email(),
  toUserId: idSchema.nullable(),
  message: z.string().max(2000).nullable().optional(),
  unlockDate: isoDateTimeSchema,
  status: giftStatusSchema,
  /** Section 2/3 nuance for the sender's view: the date passed, but has the recipient actually signed up yet? */
  recipientHasAccount: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Gift = z.infer<typeof giftSchema>;

export const createGiftInputSchema = z.object({
  journeyId: idSchema,
  recipientEmail: z.email(),
  unlockDate: isoDateTimeSchema,
  message: giftSchema.shape.message,
});
export type CreateGiftInput = z.infer<typeof createGiftInputSchema>;

/** Section 8: only while still Pending — enforced in the service, not here. */
export const updateGiftInputSchema = z.object({
  recipientEmail: z.email().optional(),
  unlockDate: isoDateTimeSchema.optional(),
  message: giftSchema.shape.message,
});
export type UpdateGiftInput = z.infer<typeof updateGiftInputSchema>;
