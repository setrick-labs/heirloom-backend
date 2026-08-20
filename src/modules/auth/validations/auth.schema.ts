import { z } from 'zod';

/**
 * Auth request DTOs. Not mirrored from mobile — the mobile app's (auth)
 * screens don't define their own schemas yet, so these are the source of
 * truth for the auth contract.
 */

const hasIdentifier = (data: { email?: string; phone?: string }) =>
  Boolean(data.email) || Boolean(data.phone);
const IDENTIFIER_ISSUE = {
  message: 'Provide an email or phone number',
  path: ['email'],
};

export const signUpInputSchema = z
  .object({
    email: z.email().optional(),
    phone: z.string().min(7).max(20).optional(),
    password: z.string().min(8).max(72),
    name: z.string().min(1).max(120),
  })
  .refine(hasIdentifier, IDENTIFIER_ISSUE);
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const signInInputSchema = z
  .object({
    email: z.email().optional(),
    phone: z.string().min(7).max(20).optional(),
    password: z.string().min(1),
  })
  .refine(hasIdentifier, IDENTIFIER_ISSUE);
export type SignInInput = z.infer<typeof signInInputSchema>;

/** `identifier` is whatever the person signed up with — email or phone, unlabeled. */
export const verifyAccountInputSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().length(6),
});
export type VerifyAccountInput = z.infer<typeof verifyAccountInputSchema>;

export const resendVerificationInputSchema = z.object({
  identifier: z.string().min(1),
});
export type ResendVerificationInput = z.infer<
  typeof resendVerificationInputSchema
>;

export const forgotPasswordInputSchema = z.object({
  identifier: z.string().min(1),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>;

export const resetPasswordInputSchema = z.object({
  /**
   * Who is resetting. Required because the proof is now a 6-digit code, not
   * an opaque token: a code is only unique *per user*, so the lookup has to
   * be scoped to one account or someone else's code could match by chance.
   */
  identifier: z.string().min(1),
  code: z.string().length(6).regex(/^\d+$/, 'Enter the 6-digit code'),
  newPassword: z.string().min(8).max(72),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

/**
 * Changing a password while signed in (Settings > Account).
 *
 * Distinct from `resetPassword`, which proves identity with an emailed token
 * because the user *can't* sign in. Here they already are, so the proof is the
 * current password — and requiring it is what stops a borrowed unlocked phone
 * from becoming a permanent account takeover.
 */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const refreshTokenInputSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenInputSchema>;
