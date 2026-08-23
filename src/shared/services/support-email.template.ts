import type { EmailContent } from './auth-email.template';

export interface SupportRequestDetails {
  title: string;
  details: string;
  reporterName: string;
  reporterEmail?: string | null;
  reporterId: string;
  /** Whatever the app knows about the device it is running on, if anything. */
  appVersion?: string | null;
  platform?: string | null;
  hasScreenshot: boolean;
}

/**
 * Copy for the in-app support form.
 *
 * Written for whoever is reading the support inbox, not for the person who
 * sent it: the subject is the user's own title so a mailbox thread list is
 * scannable, and the body leads with the report before the identifying
 * metadata, since the metadata only matters once you've decided to act.
 */
export function buildSupportRequestEmail(
  request: SupportRequestDetails,
): EmailContent {
  const context = [
    `From: ${request.reporterName}${request.reporterEmail ? ` <${request.reporterEmail}>` : ''}`,
    `User ID: ${request.reporterId}`,
    request.platform ? `Platform: ${request.platform}` : null,
    request.appVersion ? `App version: ${request.appVersion}` : null,
    `Screenshot: ${request.hasScreenshot ? 'attached' : 'none'}`,
  ].filter((line): line is string => line !== null);

  return {
    subject: `[Heirloom support] ${request.title}`,
    body: [request.details, '', '---', ...context].join('\n'),
  };
}
