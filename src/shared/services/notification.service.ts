import { Inject, Injectable, Logger } from '@nestjs/common';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  filterByPreference,
  getFamilyAudience,
  getJourneyAudience,
  type NotificationCategory,
} from '../utils/notification-audience.util';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from './auth-email.template';
import {
  buildGiftInviteEmail,
  buildGiftUnlockedEmail,
} from './gift-email.template';
import { MailerService } from './mailer.service';
import {
  buildCommentPush,
  buildFamilyJoinPush,
  buildGiftUnlockedPush,
  buildNewMemoryPush,
  buildReactionPush,
  buildVersionPush,
  buildVoiceCommentPush,
  type PushContent,
} from './push-notification.template';
import { PushService } from './push.service';

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

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mailer: MailerService,
    private readonly push: PushService,
  ) {}

  /**
   * The one path every push takes: narrow the audience to whoever still
   * wants this category, then hand it to the transport.
   *
   * Private and non-throwing, like everything else here. Callers are all
   * already-committed writes; a notification that fails must never surface
   * as a failure of the thing it was announcing.
   */
  private async pushToAudience(
    userIds: string[],
    category: NotificationCategory,
    content: PushContent,
    logLabel: string,
    collapseId?: string,
  ): Promise<void> {
    try {
      const wanted = await filterByPreference(this.db, userIds, category);
      if (wanted.length === 0) return;

      await this.push.send({
        userIds: wanted,
        title: content.title,
        body: content.body,
        link: content.link,
        collapseId,
        logLabel,
      });
    } catch (error) {
      // PushService.send already swallows transport failures; this catches
      // the audience/preference queries, which touch the database and can
      // fail independently of the provider.
      this.logger.error(`Failed to dispatch ${logLabel}: ${error}`);
    }
  }

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

  // ------------------------------------------------------------ push

  /** New memories on a Journey — everyone who can see it, except whoever added them. */
  async pushNewMemory(input: {
    actorId: string;
    actorName: string;
    journeyId: string;
    journeyTitle: string;
    milestoneId?: string | null;
    count: number;
  }): Promise<void> {
    const audience = await getJourneyAudience(
      this.db,
      input.journeyId,
      input.actorId,
    );
    await this.pushToAudience(
      audience,
      'memories',
      buildNewMemoryPush(input),
      'new memory',
      // One row per journey per uploader, replaced as more arrive, rather
      // than one per photo.
      `memory:${input.journeyId}:${input.actorId}`,
    );
  }

  /**
   * A comment, reply, or version. Reaches the memory's owner and, on a
   * reply, the author of the comment being replied to — not the whole
   * journey, which would turn one thread into a family-wide broadcast.
   *
   * A 'version' is a comment row too (see commentTypeEnum), but it is a
   * different event to a person: it goes to the `versions` preference and
   * gets its own words.
   */
  async pushComment(input: {
    actorId: string;
    actorName: string;
    recipientIds: string[];
    mediaId: string;
    body: string | null;
    commentType: 'text' | 'voice' | 'sticker' | 'version';
    isReply: boolean;
  }): Promise<void> {
    const recipients = input.recipientIds.filter((id) => id !== input.actorId);

    if (input.commentType === 'version') {
      await this.pushToAudience(
        recipients,
        'versions',
        buildVersionPush(input),
        'version',
      );
      return;
    }

    const content =
      input.commentType === 'voice'
        ? buildVoiceCommentPush(input)
        : buildCommentPush({ ...input, body: input.body ?? '' });

    await this.pushToAudience(recipients, 'comments', content, 'comment');
  }

  /** A reaction on your memory. Shares the 'comments' preference — the toggle reads "Comments and reactions". */
  async pushReaction(input: {
    actorId: string;
    actorName: string;
    ownerId: string;
    mediaId: string;
    emoji: string;
  }): Promise<void> {
    if (input.ownerId === input.actorId) return;

    await this.pushToAudience(
      [input.ownerId],
      'comments',
      buildReactionPush(input),
      'reaction',
    );
  }

  /** Someone joined a family you're in. */
  async pushFamilyJoin(input: {
    actorId: string;
    actorName: string;
    familyId: string;
    familyName: string;
  }): Promise<void> {
    const audience = await getFamilyAudience(
      this.db,
      input.familyId,
      input.actorId,
    );
    await this.pushToAudience(
      audience,
      'invites',
      buildFamilyJoinPush(input),
      'family join',
    );
  }

  /**
   * A gift has opened. Sent alongside sendGiftUnlocked's email, not instead
   * of it: the email is the durable record and reaches someone who has the
   * app uninstalled, the push is what actually gets noticed on the day.
   */
  async pushGiftUnlocked(input: {
    recipientId: string;
    senderName: string;
    journeyTitle: string;
    giftId: string;
  }): Promise<void> {
    await this.pushToAudience(
      [input.recipientId],
      'gifts',
      buildGiftUnlockedPush(input),
      'gift unlocked',
    );
  }
}
