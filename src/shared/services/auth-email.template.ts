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

export function buildPasswordResetEmail(token: string): EmailContent {
  // Without a configured app link there is still something actionable — the
  // raw token — rather than an email that refers to a button that isn't there.
  const link = env.APP_LINK_BASE_URL
    ? `${env.APP_LINK_BASE_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
    : null;

  return {
    subject: 'Reset your Heirloom password',
    body: [
      'We received a request to reset your Heirloom password.',
      '',
      link ? `Reset it here: ${link}` : `Your reset code is: ${token}`,
      '',
      `This link expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.`,
      "If you didn't ask for this, nothing has changed — you can ignore this email.",
    ].join('\n'),
  };
}
