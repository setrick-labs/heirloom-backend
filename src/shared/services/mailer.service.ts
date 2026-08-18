import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { env } from '../../config/env';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /**
   * What to call this message in the logs.
   *
   * Needed because the subject is not safe to log: verification subjects
   * carry the code itself ("120071 is your Heirloom code"), deliberately, so
   * it shows in a phone's notification preview. Logging the subject would
   * therefore write a live credential into every log aggregator the service
   * ships to. Callers name the message instead.
   */
  logLabel: string;
}

/**
 * The one place an email actually leaves the process.
 *
 * Split out from NotificationService so that service stays about *what* gets
 * sent and to whom, while this stays about transport. Swapping providers is
 * then an env change, since every mail provider worth using speaks SMTP.
 *
 * When SMTP_HOST is unset this logs the message instead of sending it — and
 * that is a deliberate, supported mode, not a failure. It keeps the entire
 * auth flow (signup verification, password reset, family invites) testable
 * locally with no provider and no account: read the code out of the server
 * log. The log line says clearly that nothing was sent, so this can't be
 * mistaken for real delivery.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter?: Transporter;

  /** Built lazily so a misconfigured SMTP block can't stop the app booting. */
  private getTransporter(): Transporter | null {
    if (!env.SMTP_HOST) return null;
    if (!this.transporter) {
      this.transporter = createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth:
          env.SMTP_USER && env.SMTP_PASSWORD
            ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
            : undefined,
      });
    }
    return this.transporter;
  }

  get isConfigured(): boolean {
    return Boolean(env.SMTP_HOST);
  }

  /**
   * Never throws. A failed send must not fail the request that triggered it:
   * a signup whose verification email bounces has still created the account,
   * and the user can ask for another code. Callers are all fire-and-forget or
   * already-committed writes, so a rejection here would surface as a 500 on
   * an operation that actually succeeded.
   */
  async send(email: OutboundEmail): Promise<boolean> {
    const transporter = this.getTransporter();

    if (!transporter) {
      // The full message, code and all, is intentional here: with no provider
      // configured this log IS the delivery mechanism, and the flow has to
      // stay testable locally. It never runs once SMTP is set up.
      this.logger.warn(
        `[email NOT sent — no SMTP configured] To ${email.to} — ${email.subject}\n${email.body}`,
      );
      return false;
    }

    try {
      await transporter.sendMail({
        from: env.MAIL_FROM ?? env.SMTP_USER,
        to: email.to,
        subject: email.subject,
        text: email.body,
      });
      this.logger.log(`Sent ${email.logLabel} to ${email.to}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send ${email.logLabel} to ${email.to}: ${error}`,
      );
      return false;
    }
  }
}
