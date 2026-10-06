import { env } from '../../config/env';
import type { EmailContent } from './auth-email.template';
import { renderEmail, safe, storeLinksText, strong } from './email-layout';

/**
 * Invite by email. The link is single-use and bound to this address, so the
 * copy says so — a forwarded invite fails at accept time, and the reader
 * should know why before it does.
 */
export function buildFamilyInviteEmail(input: {
  inviterName: string;
  familyName: string;
  memberCount: number;
  url: string;
}): EmailContent {
  const ttl = env.FAMILY_EMAIL_INVITE_TTL_DAYS;
  const subject = `${input.inviterName} invited you to ${input.familyName} on Heirloom`;
  const alreadyThere =
    input.memberCount === 1
      ? '1 person is already there.'
      : `${input.memberCount} people are already there.`;

  return {
    subject,
    body: [
      subject,
      '',
      `Heirloom is where ${input.familyName} keeps its photos, videos and voices together. ${alreadyThere}`,
      '',
      `Join the family: ${input.url}`,
      '',
      `Don't have the app yet? Install it, then open this link again — or just sign up with this email address and the invite will be waiting.`,
      `This invite is just for you and expires in ${ttl} days.`,
      ...storeLinksText(),
    ].join('\n'),
    html: renderEmail({
      preheader: `Join ${input.familyName} on Heirloom. ${alreadyThere}`,
      eyebrow: 'Family invite',
      heading: `You're invited to ${input.familyName}`,
      paragraphs: [
        safe`${strong(input.inviterName)} invited you to join ${strong(input.familyName)} on Heirloom — a private place where your family keeps its photos, videos and voices together.`,
        alreadyThere,
      ],
      cta: { label: 'Join the family', url: input.url },
      notes: [
        "Don't have the app yet? Install it below, then sign up with this email address — the invite will be waiting for you.",
        `This invite is just for you and expires in ${ttl} days.`,
      ],
      showStoreBadges: true,
    }),
  };
}
