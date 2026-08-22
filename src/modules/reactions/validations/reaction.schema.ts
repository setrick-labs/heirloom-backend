import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/**
 * Same polymorphic target as comments (database/schema/enums.ts). 'comment'
 * has to be here, not just in the DB enum: a comment like is an ordinary
 * reaction with targetType 'comment' (see comments.service.ts), and this is
 * the schema that gates every POST/DELETE/GET /reactions call.
 */
export const reactionTargetTypeSchema = z.enum([
  'milestone',
  'media',
  'moment',
  'event',
  'comment',
]);
export type ReactionTargetType = z.infer<typeof reactionTargetTypeSchema>;

const emojiSchema = z.string().min(1).max(16);

/** How many reactor ids a summary keeps per emoji — enough to name a few people, never the whole crowd. */
export const REACTOR_NAMES_LIMIT = 8;

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
 *
 * `reactorIds` carries who, not just how many — capped rather than the full
 * list, since a "Liked by X and N more" line only ever needs to name a
 * handful of people regardless of how large the count gets.
 */
export const reactionSummarySchema = z.object({
  emoji: emojiSchema,
  count: z.number().int().min(1),
  reactedByMe: z.boolean(),
  reactorIds: z.array(idSchema),
});
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;
