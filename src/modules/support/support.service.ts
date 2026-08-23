import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { users } from '../../database/schema';
import { MailerService } from '../../shared/services/mailer.service';
import { buildSupportRequestEmail } from '../../shared/services/support-email.template';
import {
  CreateSupportRequestInput,
  SupportRequestResult,
} from './validations/support.schema';

const MEGABYTE = 1024 * 1024;

/** A screenshot, not a photo library — 8MB is generous for a phone screen grab. */
export const MAX_SCREENSHOT_BYTES = 8 * MEGABYTE;

/**
 * Deliberately narrower than the media allow-list: a support attachment is a
 * screenshot, and there is no reason for this endpoint to accept video, audio,
 * or a format (HEIC) that whoever opens the ticket may not be able to view.
 */
export const ALLOWED_SCREENSHOT_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface SupportScreenshot {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * In-app support requests: a title, what happened, and optionally a
 * screenshot, emailed to whoever staffs SUPPORT_EMAIL.
 *
 * Nothing is persisted. There is no support-ticket table because there is no
 * screen that reads one — the inbox *is* the queue, and a table nobody
 * queries is a second copy of user-reported bug text to keep, migrate, and
 * eventually leak. If triage ever moves in-app, that is the point to add one.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mailer: MailerService,
  ) {}

  /** Falls back to MAIL_FROM so any deployment that can send mail at all can take support. */
  private get destination(): string | undefined {
    return env.SUPPORT_EMAIL ?? env.MAIL_FROM ?? env.SMTP_USER;
  }

  async submit(
    userId: string,
    input: CreateSupportRequestInput,
    screenshot?: SupportScreenshot,
  ): Promise<SupportRequestResult> {
    if (screenshot) this.assertValidScreenshot(screenshot);

    const to = this.destination;
    if (!to) {
      // Unlike the transactional emails, this one *is* the operation — there
      // is no account created, no gift unlocked, nothing already committed
      // that a silent failure would degrade gracefully around. Saying so
      // beats accepting a report that goes nowhere.
      this.logger.error(
        'Support request received but no destination is configured (SUPPORT_EMAIL / MAIL_FROM / SMTP_USER).',
      );
      throw new ServiceUnavailableException({
        code: 'SUPPORT_UNAVAILABLE',
        message:
          "Support isn't reachable right now. Please try again in a little while.",
      });
    }

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) throw new NotFoundException('User not found');

    const email = buildSupportRequestEmail({
      title: input.title,
      details: input.details,
      reporterName: user.name,
      reporterEmail: user.email,
      reporterId: user.id,
      platform: input.platform,
      appVersion: input.appVersion,
      hasScreenshot: Boolean(screenshot),
    });

    const sent = await this.mailer.send({
      to,
      subject: email.subject,
      body: email.body,
      logLabel: 'support request',
      // The reporter's own words go in the body; only the image is attached.
      attachments: screenshot
        ? [
            {
              filename: `screenshot.${ALLOWED_SCREENSHOT_MIME_TYPES[screenshot.mimetype]}`,
              content: screenshot.buffer,
              contentType: screenshot.mimetype,
            },
          ]
        : undefined,
    });

    if (!sent) {
      // MailerService never throws by design, so the boolean is the only
      // signal — and here a failed send means the report simply does not
      // exist anywhere. Never answer "thanks, we got it" to that.
      throw new ServiceUnavailableException({
        code: 'SUPPORT_DELIVERY_FAILED',
        message:
          "We couldn't send that just now. Try again, or email support directly.",
      });
    }

    return { delivered: true };
  }

  private assertValidScreenshot(screenshot: SupportScreenshot): void {
    if (!ALLOWED_SCREENSHOT_MIME_TYPES[screenshot.mimetype]) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_SCREENSHOT_TYPE',
        message: `Screenshots must be a JPEG, PNG, or WebP image (got "${screenshot.mimetype}").`,
      });
    }

    // Multer already refuses anything past its own `limits.fileSize` (see the
    // controller, and the MulterError branch in GlobalExceptionFilter that
    // turns that into a 400). This is the backstop for the exactly-at-limit
    // case, and keeps the rule stated where the rest of the policy lives.
    if (screenshot.size > MAX_SCREENSHOT_BYTES) {
      throw new BadRequestException({
        code: 'SCREENSHOT_TOO_LARGE',
        message: `That screenshot is too large (${Math.ceil(screenshot.size / MEGABYTE)}MB). Max is ${MAX_SCREENSHOT_BYTES / MEGABYTE}MB.`,
      });
    }
  }
}
