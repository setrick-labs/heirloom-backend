import { env } from '../../config/env';

export interface EmailContent {
  subject: string;
  body: string;
}

/**
 * Copy for the transactional auth emails.
 *
 * Kept beside gift-email.template.ts and separate from the transport for the
 * same reason: swapping mail providers must never mean rewriting the words a
 * person actually reads.
 */

export function buildVerificationEmail(code: string): EmailContent {
  return {
    subject: `${code} is your Heirloom code`,
    body: [
      'Welcome to Heirloom.',
      '',
      `Your verification code is: ${code}`,
      '',
      `It expires in ${env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES} minutes.`,
      "If you didn't create an account, you can ignore this email.",
    ].join('\n'),
  };
}

export function buildPasswordResetEmail(code: string): EmailContent {
  return {
    // The code stays out of the subject, unlike the verification email's.
    // Subjects show in notification previews and sync to places the body
    // doesn't, and this one opens an account whose password is being changed.
    subject: 'Reset your Heirloom password',
    body: [
      'We received a request to reset your Heirloom password.',
      '',
      `Your reset code is: ${code}`,
      '',
      `Enter it in the app to choose a new password. It expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.`,
      "If you didn't ask for this, nothing has changed — you can ignore this email.",
    ].join('\n'),
  };
}
