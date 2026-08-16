import { z } from 'zod';

import { idSchema } from '../../../shared/validations/common.schema';

/** Only the two surfaces the flow badges — see viewTargetTypeEnum. */
export const viewTargetTypeSchema = z.enum(['journey', 'milestone']);
export type ViewTargetType = z.infer<typeof viewTargetTypeSchema>;

/**
 * "I have now looked at this." Sent when a Journey or Milestone screen
 * opens. Deliberately carries no timestamp — the server stamps it, so a
 * device with a skewed clock can't mark content read into the future and
 * permanently suppress its own badge.
 */
export const markSeenInputSchema = z.object({
  targetType: viewTargetTypeSchema,
  targetId: idSchema,
});
export type MarkSeenInput = z.infer<typeof markSeenInputSchema>;
