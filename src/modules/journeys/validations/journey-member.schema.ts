import { z } from 'zod';

import { idSchema } from '../../../shared/validations/common.schema';

/**
 * "Who has access" — for 'all' journeys this is every current family
 * member (computed, not stored); for 'selected' journeys it's the explicit
 * list. Names are resolved the same way as the family roster (alias if the
 * viewer has one set, else display name) for consistency.
 */
export const journeyMemberViewSchema = z.object({
  userId: idSchema,
  displayName: z.string(),
  resolvedName: z.string(),
  isOwner: z.boolean(),
});
export type JourneyMemberView = z.infer<typeof journeyMemberViewSchema>;
