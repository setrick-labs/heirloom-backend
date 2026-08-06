import { Injectable, Logger } from '@nestjs/common';

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
}
