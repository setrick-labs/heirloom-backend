import { env } from '../../config/env';
import { renderEmail, safe, strong } from './email-layout';

export interface EmailContent {
  subject: string;
  /** Plain-text part — always sent, so every email still reads without HTML. */
  body: string;
  html: string;
}

/**
 * Copy for the transactional auth and security emails.
 *
 * Kept beside gift-email.template.ts and separate from the transport for the
 * same reason: swapping mail providers must never mean rewriting the words a
 * person actually reads.
 *
 * None of these show store badges: whoever reads them already has the app,
 * and security mail should not be training people to tap install links.
 */

function appLink(path: string): string | null {
  return env.APP_LINK_BASE_URL
    ? `${env.APP_LINK_BASE_URL.replace(/\/$/, '')}${path}`
    : null;
}

function supportLine(): string {
  return `If this wasn't you, reset your password from the Heirloom sign-in screen straight away and contact ${env.SUPPORT_EMAIL ?? 'support@heirloom.setrick.com'}.`;
}

function formatWhen(when: Date): string {
  return `${when.toUTCString().replace('GMT', 'UTC')}`;
}

export function buildVerificationEmail(code: string): EmailContent {
  const ttl = env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES;
  return {
    subject: `${code} is your Heirloom code`,
    body: [
      'Welcome to Heirloom.',
      '',
      `Your verification code is: ${code}`,
      '',
      `It expires in ${ttl} minutes.`,
      "If you didn't create an account, you can ignore this email.",
    ].join('\n'),
    html: renderEmail({
      preheader: `Enter this code in the app to finish signing up. It expires in ${ttl} minutes.`,
      eyebrow: 'Verify your email',
      heading: 'Welcome to Heirloom',
      paragraphs: [
        'Enter this code in the app to finish creating your account.',
      ],
      code: { value: code, caption: `Expires in ${ttl} minutes` },
      notes: ["If you didn't create an account, you can ignore this email."],
    }),
  };
}

/** Confirms an address being added to an existing (phone-only) account. */
export function buildConfirmEmailEmail(code: string): EmailContent {
  const ttl = env.ACCOUNT_VERIFICATION_CODE_TTL_MINUTES;
  return {
    subject: `${code} is your Heirloom code`,
    body: [
      'Confirm this email address for your Heirloom account.',
      '',
      `Your code is: ${code}`,
      '',
      `It expires in ${ttl} minutes. We'll use this address to help you recover your account and Vault.`,
      "If you didn't ask for this, you can ignore this email.",
    ].join('\n'),
    html: renderEmail({
      preheader: `Enter this code in the app. It expires in ${ttl} minutes.`,
      eyebrow: 'Confirm your email',
      heading: 'Add this email to Heirloom',
      paragraphs: [
        "Enter this code in the app to confirm this address. We'll use it to help you recover your account and Vault.",
      ],
      code: { value: code, caption: `Expires in ${ttl} minutes` },
      notes: ["If you didn't ask for this, you can ignore this email."],
    }),
  };
}

export function buildPasswordResetEmail(
  code: string,
  email?: string,
): EmailContent {
  const ttl = env.PASSWORD_RESET_TOKEN_TTL_MINUTES;
  // One tap on the phone that has the app: the universal link opens the
  // reset screen with both fields filled. The code stays in the body as the
  // fallback for every other case (link opened on a laptop, app too old).
  const link = email
    ? appLink(
        `/reset-password?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`,
      )
    : null;

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
      `Enter it in the app to choose a new password. It expires in ${ttl} minutes and can only be used once.`,
      ...(link ? ['', `Or open this on your phone: ${link}`] : []),
      "If you didn't ask for this, nothing has changed — you can ignore this email.",
    ].join('\n'),
    html: renderEmail({
      preheader: `Your reset code expires in ${ttl} minutes.`,
      eyebrow: 'Password reset',
      heading: 'Reset your password',
      paragraphs: [
        'We received a request to reset your Heirloom password. Enter this code in the app to choose a new one.',
      ],
      code: { value: code, caption: `Expires in ${ttl} minutes · single use` },
      cta: link ? { label: 'Reset in the app', url: link } : undefined,
      notes: [
        "If you didn't ask for this, nothing has changed — you can ignore this email.",
      ],
    }),
  };
}

/** Sent after a reset and after a signed-in change — both sign out every other device. */
export function buildPasswordChangedEmail(input: {
  name: string;
  when: Date;
}): EmailContent {
  const when = formatWhen(input.when);
  return {
    subject: 'Your Heirloom password was changed',
    body: [
      `Hi ${input.name},`,
      '',
      `The password for your Heirloom account was changed on ${when}. Every other device has been signed out.`,
      '',
      supportLine(),
    ].join('\n'),
    html: renderEmail({
      preheader: 'Every other device has been signed out.',
      eyebrow: 'Security alert',
      heading: 'Your password was changed',
      paragraphs: [
        `Hi ${input.name},`,
        `The password for your Heirloom account was changed on ${when}. Every other device has been signed out.`,
      ],
      notes: [supportLine()],
    }),
  };
}

/**
 * The second factor of Vault recovery. `vaultName` is set for a shared
 * vault; omitted for the personal Private Vault.
 */
export function buildVaultRecoveryEmail(input: {
  code: string;
  vaultName?: string;
}): EmailContent {
  const ttl = env.VAULT_RECOVERY_CODE_TTL_MINUTES;
  const which = input.vaultName
    ? `the shared vault "${input.vaultName}"`
    : 'your Private Vault';
  return {
    // Same rule as the password reset: no credential in the subject.
    subject: 'Your Heirloom Vault recovery code',
    body: [
      `Someone asked to reset the passcode for ${which}.`,
      '',
      `Your recovery code is: ${input.code}`,
      '',
      `Enter it in the app to choose a new passcode. It expires in ${ttl} minutes and can only be used once.`,
      "If this wasn't you, don't share this code — and change your account password, since whoever asked already knew it.",
    ].join('\n'),
    html: renderEmail({
      preheader: `Your Vault recovery code expires in ${ttl} minutes.`,
      eyebrow: 'Vault recovery',
      heading: 'Reset your Vault passcode',
      paragraphs: [
        input.vaultName
          ? safe`Someone asked to reset the passcode for the shared vault ${strong(input.vaultName)}. Enter this code in the app to choose a new one.`
          : 'Someone asked to reset your Private Vault passcode. Enter this code in the app to choose a new one.',
      ],
      code: {
        value: input.code,
        caption: `Expires in ${ttl} minutes · single use`,
      },
      notes: [
        "If this wasn't you, don't share this code — and change your account password, since whoever asked already knew it.",
      ],
    }),
  };
}

export function buildVaultPasscodeResetEmail(input: {
  name: string;
  when: Date;
  vaultName?: string;
}): EmailContent {
  const when = formatWhen(input.when);
  const which = input.vaultName
    ? `the shared vault "${input.vaultName}"`
    : 'your Private Vault';
  return {
    subject: 'Your Heirloom Vault passcode was reset',
    body: [
      `Hi ${input.name},`,
      '',
      `The passcode for ${which} was reset on ${when}.`,
      '',
      supportLine(),
    ].join('\n'),
    html: renderEmail({
      preheader: `The passcode for ${which} was just reset.`,
      eyebrow: 'Security alert',
      heading: 'Your Vault passcode was reset',
      paragraphs: [
        `Hi ${input.name},`,
        `The passcode for ${which} was reset on ${when}.`,
      ],
      notes: [supportLine()],
    }),
  };
}
