import { Injectable, Logger } from '@nestjs/common';

import {
  buildGiftInviteEmail,
  buildGiftUnlockedEmail,
} from './gift-email.template';

/**
 * Stub notification sender — no email/SMS provider is wired up yet (no
 * SendGrid/Twilio/etc. keys exist in env.ts). Every method just logs what
 * would have been sent, at a visible level, so the full auth flow (signup
 * verification, password reset, invite links) is actually testable end to
 * end locally: read the code out of the server log instead of an inbox.
 *
 * Swap the bodies of these methods for a real provider call when one is
 * chosen — the call sites (AuthService, FamiliesService) don't need to change.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  sendAccountVerificationCode(identifier: string, code: string): Promise<void> {
    this.logger.warn(
      `[stub email/sms] Verification code for ${identifier}: ${code} ` +
        '(no provider configured — wire one up in NotificationService)',
    );
    return Promise.resolve();
  }

  sendPasswordResetLink(identifier: string, token: string): Promise<void> {
    this.logger.warn(
      `[stub email/sms] Password reset token for ${identifier}: ${token} ` +
        '(no provider configured — wire one up in NotificationService)',
    );
    return Promise.resolve();
  }

  /**
   * Screen 40 / Gifting spec Section 5: reads as "someone has something for
   * you," not a generic signup prompt. Copy and CTA live in
   * gift-email.template.ts, so wiring a real provider is a transport swap
   * rather than a rewrite of the message.
   */
  sendGiftInvite(
    recipientEmail: string,
    senderName: string,
    journeyTitle: string,
    recipientName?: string | null,
  ): Promise<void> {
    const email = buildGiftInviteEmail({
      recipientEmail,
      recipientName,
      senderName,
      journeyTitle,
    });
    this.logger.warn(
      `[stub email] To ${recipientEmail} — ${email.subject}\n${email.body}\n` +
        '(no provider configured — wire one up in NotificationService)',
    );
    return Promise.resolve();
  }

  /** Section 4: the recipient already has an account — this points them at the reveal, not a signup flow. */
  sendGiftUnlocked(
    recipientEmail: string,
    senderName: string,
    journeyTitle: string,
  ): Promise<void> {
    const email = buildGiftUnlockedEmail({ senderName, journeyTitle });
    this.logger.warn(
      `[stub email] To ${recipientEmail} — ${email.subject}\n${email.body}\n` +
        '(no provider configured — wire one up in NotificationService)',
    );
    return Promise.resolve();
  }
}
