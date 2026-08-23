import { z } from 'zod';

/**
 * The in-app support form (Help & Support -> Contact support).
 *
 * Arrives as multipart/form-data, because the screenshot is a file — so
 * every field here is a string on the wire, and nothing may be `z.number()`
 * or `z.boolean()` without a coercion.
 */
export const createSupportRequestInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  details: z.string().trim().min(10).max(4000),
  /**
   * Optional device context the app fills in for us. Kept free-form and
   * capped rather than modelled: it exists to help whoever reads the report,
   * and a rigid schema here would mean a failed support request the day the
   * app starts sending one more field.
   */
  platform: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(40).optional(),
});
export type CreateSupportRequestInput = z.infer<
  typeof createSupportRequestInputSchema
>;

export const supportRequestResultSchema = z.object({
  delivered: z.literal(true),
});
export type SupportRequestResult = z.infer<typeof supportRequestResultSchema>;
