import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

/** Invite by email — admin/owner sends to up to 10 addresses at once. */
export const sendEmailInvitesInputSchema = z.object({
  emails: z.array(z.email()).min(1).max(10),
});
export type SendEmailInvitesInput = z.infer<typeof sendEmailInvitesInputSchema>;

/** A pending invite as the family admin sees it (Family screen). */
export const familyEmailInviteSchema = z.object({
  id: idSchema,
  email: z.string(),
  invitedByName: z.string(),
  expiresAt: isoDateTimeSchema,
  lastSentAt: isoDateTimeSchema,
  expired: z.boolean(),
});
export type FamilyEmailInvite = z.infer<typeof familyEmailInviteSchema>;

export const sendEmailInvitesResultSchema = z.object({
  sent: z.array(familyEmailInviteSchema),
  /** Addresses that already belong to a member of this family. */
  alreadyMembers: z.array(z.string()),
});
export type SendEmailInvitesResult = z.infer<
  typeof sendEmailInvitesResultSchema
>;

/**
 * What the link's landing page (web and app) may show before sign-in: who
 * invited you, to what, and a masked address so you know which account to
 * use. Never the family's content.
 */
export const emailInvitePreviewSchema = z.object({
  familyName: z.string(),
  inviterName: z.string(),
  memberCount: z.number().int().min(0),
  invitedEmail: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type EmailInvitePreview = z.infer<typeof emailInvitePreviewSchema>;

/** Invites waiting for the signed-in user's own (verified) address. */
export const myEmailInviteSchema = z.object({
  id: idSchema,
  familyId: idSchema,
  familyName: z.string(),
  inviterName: z.string(),
  memberCount: z.number().int().min(0),
  expiresAt: isoDateTimeSchema,
});
export type MyEmailInvite = z.infer<typeof myEmailInviteSchema>;

/**
 * Accept by the link's token, or by id for an invite found through
 * GET /families/email-invites/mine (the post-install path, where the link
 * was lost in the store). Both are checked against the caller's email.
 */
export const acceptEmailInviteInputSchema = z
  .object({
    token: z.string().min(32).max(128).optional(),
    inviteId: idSchema.optional(),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.inviteId), {
    message: 'Provide either token or inviteId',
  });
export type AcceptEmailInviteInput = z.infer<
  typeof acceptEmailInviteInputSchema
>;
