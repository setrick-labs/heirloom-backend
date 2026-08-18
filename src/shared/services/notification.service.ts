import { Injectable, Logger } from '@nestjs/common';

import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from './auth-email.template';
import {
  buildGiftInviteEmail,
  buildGiftUnlockedEmail,
} from './gift-email.template';
import { MailerService } from './mailer.service';

/**
 * What gets sent, to whom, and why — the transport itself lives in
 * MailerService.
 *
 * Every method here is deliberately non-throwing. These are all called from
 * inside operations that have already committed (an account exists, a gift
 * has unlocked), so a delivery failure must degrade to "no email arrived",
 * never to a 500 on work that actually succeeded. MailerService.send()
 * already swallows and logs; this layer keeps that contract explicit.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly mailer: MailerService) {}

  /**
   * Phone delivery isn't wired: there is no SMS provider in env, and signing
   * up with a phone number is allowed. Rather than silently dropping the
   * code, it is logged at warn — the account is real and verifiable, the
   * operator just has to read the log until an SMS provider exists.
   */
  private isEmail(identifier: string): boolean {
    return identifier.includes('@');
  }

  async sendAccountVerificationCode(
    identifier: string,
    code: string,
  ): Promise<void> {
    const email = buildVerificationEmail(code);

    if (!this.isEmail(identifier)) {
      this.logger.warn(
        `[sms NOT sent — no SMS provider configured] To ${identifier}: ${code}`,
      );
      return;
    }

    await this.mailer.send({
      to: identifier,
      subject: email.subject,
      body: email.body,
      logLabel: 'verification code',
    });
  }

  async sendPasswordResetLink(
    identifier: string,
    token: string,
  ): Promise<void> {
    const email = buildPasswordResetEmail(token);

    if (!this.isEmail(identifier)) {
      this.logger.warn(
        `[sms NOT sent — no SMS provider configured] Reset token for ${identifier}: ${token}`,
      );
      return;
    }

    await this.mailer.send({
      to: identifier,
      subject: email.subject,
      body: email.body,
      logLabel: 'password reset link',
    });
  }

  /**
   * Screen 40 / Gifting spec Section 5: reads as "someone has something for
   * you," not a generic signup prompt.
   */
  async sendGiftInvite(
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
    await this.mailer.send({
      to: recipientEmail,
      subject: email.subject,
      body: email.body,
      logLabel: 'gift invite',
    });
  }

  /** Section 4: the recipient already has an account — this points them at the reveal, not a signup flow. */
  async sendGiftUnlocked(
    recipientEmail: string,
    senderName: string,
    journeyTitle: string,
  ): Promise<void> {
    const email = buildGiftUnlockedEmail({ senderName, journeyTitle });
    await this.mailer.send({
      to: recipientEmail,
      subject: email.subject,
      body: email.body,
      logLabel: 'gift unlocked notice',
    });
  }
}
