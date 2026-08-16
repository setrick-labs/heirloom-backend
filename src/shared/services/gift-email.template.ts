import { env } from '../../config/env';

export interface GiftEmailContent {
  subject: string;
  body: string;
  /** Null when APP_LINK_BASE_URL isn't configured — the email still stands alone. */
  ctaUrl: string | null;
}

/**
 * Screen 40 — the non-user reveal path.
 *
 * "Warm, personal email with the sender's framing and a single CTA." The
 * recipient has no account, so the CTA deep-links into Sign Up with their
 * address pre-filled — that pre-fill is load-bearing: gifts are matched by
 * `recipientEmail`, so signing up with a different address would silently
 * fail to find the gift they were just told about.
 */
export function buildGiftInviteEmail(input: {
  recipientEmail: string;
  recipientName?: string | null;
  senderName: string;
  journeyTitle: string;
}): GiftEmailContent {
  const greetingName = input.recipientName?.trim();
  const subject = greetingName
    ? `A gift is waiting for you, ${greetingName}`
    : 'A gift is waiting for you';

  const ctaUrl = env.APP_LINK_BASE_URL
    ? `${env.APP_LINK_BASE_URL.replace(/\/$/, '')}/sign-up?email=${encodeURIComponent(input.recipientEmail)}`
    : null;

  const body = [
    subject,
    '',
    `${input.senderName} saved "${input.journeyTitle}" for you — photos and videos kept just for this day. Join Heirloom to open it.`,
    '',
    ctaUrl
      ? `See Your Gift: ${ctaUrl}`
      : `Sign up at Heirloom with ${input.recipientEmail} to open it.`,
  ].join('\n');

  return { subject, body, ctaUrl };
}

/** Section 4 — the recipient already has an account, so this points at the app, not a signup. */
export function buildGiftUnlockedEmail(input: {
  senderName: string;
  journeyTitle: string;
}): GiftEmailContent {
  const subject = `${input.senderName} gifted you a Journey`;
  const ctaUrl = env.APP_LINK_BASE_URL
    ? `${env.APP_LINK_BASE_URL.replace(/\/$/, '')}/gifts`
    : null;

  const body = [
    subject,
    '',
    `"${input.journeyTitle}" is ready to open. It's been waiting for today.`,
    '',
    ctaUrl ? `Open Heirloom: ${ctaUrl}` : 'Open Heirloom to see it.',
  ].join('\n');

  return { subject, body, ctaUrl };
}
