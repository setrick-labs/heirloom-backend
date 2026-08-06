import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/** Same polymorphic target as comments (database/schema/enums.ts) — Milestones spec drives 'media' only. */
export const reactionTargetTypeSchema = z.enum([
  'milestone',
  'media',
  'moment',
  'event',
]);
export type ReactionTargetType = z.infer<typeof reactionTargetTypeSchema>;

const emojiSchema = z.string().min(1).max(16);

export const reactionSchema = z.object({
  id: idSchema,
  targetType: reactionTargetTypeSchema,
  targetId: idSchema,
  userId: idSchema,
  emoji: emojiSchema,
  createdAt: isoDateTimeSchema,
});
export type Reaction = z.infer<typeof reactionSchema>;

export const addReactionInputSchema = reactionSchema.pick({
  targetType: true,
  targetId: true,
  emoji: true,
});
export type AddReactionInput = z.infer<typeof addReactionInputSchema>;

/**
 * Grouped by emoji for rendering the reaction bar — Section 5 recommends
 * allowing multiple reaction types per person per image (both ❤️ and 😂 on
 * the same photo), so the useful shape is per-emoji counts, not a flat list.
 */
export const reactionSummarySchema = z.object({
  emoji: emojiSchema,
  count: z.number().int().min(1),
  reactedByMe: z.boolean(),
});
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;
