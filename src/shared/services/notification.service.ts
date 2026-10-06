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
  buildConfirmEmailEmail,
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildVaultPasscodeResetEmail,
  buildVaultRecoveryEmail,
  buildVerificationEmail,
  type EmailContent,
} from './auth-email.template';
import {
  buildGiftInviteEmail,
  buildGiftUnlockedEmail,
} from './gift-email.template';
import { buildFamilyInviteEmail } from './family-email.template';
import { MailerService } from './mailer.service';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationsGateway } from './notifications.gateway';
import {
  buildCommentPush,
  buildFamilyInvitePush,
  buildFamilyJoinPush,
  buildGiftUnlockedPush,
  buildNewMemoryPush,
  buildReactionPush,
  buildSharedVaultDeletionRequestPush,
  buildSharedVaultDeletionResultPush,
  buildSharedVaultInvitePush,
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
    private readonly notificationFeed: NotificationFeedService,
    private readonly gateway: NotificationsGateway,
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
      html: email.html,
      logLabel: 'verification code',
    });
  }

  async sendPasswordResetLink(
    identifier: string,
    token: string,
  ): Promise<void> {
    const email = buildPasswordResetEmail(
      token,
      this.isEmail(identifier) ? identifier : undefined,
    );

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
      html: email.html,
      logLabel: 'password reset link',
    });
  }

  /**
   * Security mail to an address already on the account. Skipped (with a log
   * line) for phone-only accounts, which have nowhere to send it.
   */
  private async sendSecurityEmail(
    to: string | null,
    email: EmailContent,
    logLabel: string,
  ): Promise<void> {
    if (!to) {
      this.logger.warn(`Skipped ${logLabel}: account has no email address`);
      return;
    }
    await this.mailer.send({
      to,
      subject: email.subject,
      body: email.body,
      html: email.html,
      logLabel,
    });
  }

  async sendConfirmEmailCode(to: string, code: string): Promise<void> {
    await this.sendSecurityEmail(
      to,
      buildConfirmEmailEmail(code),
      'email confirmation code',
    );
  }

  async sendPasswordChanged(user: {
    email: string | null;
    name: string;
  }): Promise<void> {
    await this.sendSecurityEmail(
      user.email,
      buildPasswordChangedEmail({ name: user.name, when: new Date() }),
      'password changed alert',
    );
  }

  /** `vaultName` set = a shared vault; unset = the personal Private Vault. */
  async sendVaultRecoveryCode(
    to: string | null,
    code: string,
    vaultName?: string,
  ): Promise<void> {
    await this.sendSecurityEmail(
      to,
      buildVaultRecoveryEmail({ code, vaultName }),
      'vault recovery code',
    );
  }

  async sendVaultPasscodeReset(
    user: { email: string | null; name: string },
    vaultName?: string,
  ): Promise<void> {
    await this.sendSecurityEmail(
      user.email,
      buildVaultPasscodeResetEmail({
        name: user.name,
        when: new Date(),
        vaultName,
      }),
      'vault passcode reset alert',
    );
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
      html: email.html,
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
      html: email.html,
      logLabel: 'gift unlocked notice',
    });
  }

  // ------------------------------------------------------------ push

  /** New memories on a Journey — everyone who can see it, except whoever added them. */
  async pushNewMemory(input: {
    actorId: string;
    actorName: string;
    familyId: string;
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
    // Everyone who can see it, whatever their push preference: this only
    // refreshes the lists and "N new" badges already on their screen.
    this.gateway.emitToUsers(audience, 'content:changed', {
      familyId: input.familyId,
      journeyId: input.journeyId,
      milestoneId: input.milestoneId ?? null,
    });
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
    if (recipients.length === 0) return;

    const isVersion = input.commentType === 'version';
    const content = isVersion
      ? buildVersionPush(input)
      : input.commentType === 'voice'
        ? buildVoiceCommentPush(input)
        : buildCommentPush({ ...input, body: input.body ?? '' });

    // The bell's durable record of the same event — see notification-feed
    // .service.ts — reusing the push's exact copy so the two never drift.
    // Run alongside the push, not after it: recording is what emits the
    // in-app `notification:new`, and waiting on OneSignal first held every
    // in-app notification back by that provider's round trip.
    await Promise.all([
      this.pushToAudience(
        recipients,
        isVersion ? 'versions' : 'comments',
        content,
        isVersion ? 'version' : 'comment',
      ),
      ...recipients.map((recipientId) =>
        this.notificationFeed.record({
          recipientId,
          actorId: input.actorId,
          type: 'comment',
          targetType: 'media',
          targetId: input.mediaId,
          mediaId: input.mediaId,
          title: content.title,
          body: content.body,
        }),
      ),
    ]);
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

    const content = buildReactionPush(input);
    // Side by side for the same reason as pushComment.
    await Promise.all([
      this.pushToAudience([input.ownerId], 'comments', content, 'reaction'),
      this.notificationFeed.record({
        recipientId: input.ownerId,
        actorId: input.actorId,
        type: 'reaction',
        targetType: 'media',
        targetId: input.mediaId,
        mediaId: input.mediaId,
        title: content.title,
        body: content.body,
      }),
    ]);
  }

  /** Someone joined a family you're in. */
  /** Emailed family invite, delivered to an existing account's email and phone. */
  async sendFamilyInvite(input: {
    to: string;
    inviterName: string;
    familyName: string;
    memberCount: number;
    url: string;
    /** Set when the address already belongs to an account — they get a push too. */
    existingUserId?: string;
    inviteId: string;
  }): Promise<void> {
    const email = buildFamilyInviteEmail(input);
    await this.mailer.send({
      to: input.to,
      subject: email.subject,
      body: email.body,
      html: email.html,
      logLabel: 'family invite',
    });
    if (input.existingUserId) {
      await this.pushToAudience(
        [input.existingUserId],
        'invites',
        buildFamilyInvitePush(input),
        'family invite',
      );
    }
  }

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
    // Member lists on everyone else's screen pick the newcomer up now,
    // rather than when the family's 10-minute cache runs out.
    this.gateway.emitToUsers(audience, 'family:changed', {
      familyId: input.familyId,
    });
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

  /** Invited to a shared vault — rides the "invites" preference. */
  async pushSharedVaultInvite(input: {
    recipientIds: string[];
    actorName: string;
    vaultName: string;
    vaultId: string;
  }): Promise<void> {
    await this.pushToAudience(
      input.recipientIds,
      'invites',
      buildSharedVaultInvitePush(input),
      'shared vault invite',
    );
  }

  /**
   * Someone asked to delete something shared. Deliberately NOT filtered by a
   * preference: this is a request for the recipient's consent, and a
   * deletion that stalls because the only people who could approve it had
   * switched notifications off is a request nobody can act on.
   */
  async pushSharedVaultDeletionRequest(input: {
    recipientIds: string[];
    actorName: string;
    vaultName: string;
    vaultId: string;
    wholeVault: boolean;
  }): Promise<void> {
    if (input.recipientIds.length === 0) return;
    const content = buildSharedVaultDeletionRequestPush(input);
    try {
      await this.push.send({
        userIds: input.recipientIds,
        title: content.title,
        body: content.body,
        link: content.link,
        logLabel: 'shared vault deletion request',
      });
    } catch (error) {
      this.logger.error(`Failed to dispatch shared vault deletion request: ${error}`);
    }
  }

  /** How a deletion request ended, to the person who asked. */
  async pushSharedVaultDeletionResult(input: {
    recipientId: string;
    vaultName: string;
    vaultId: string;
    outcome: 'approved' | 'declined' | 'expired';
    wholeVault: boolean;
  }): Promise<void> {
    const content = buildSharedVaultDeletionResultPush(input);
    try {
      await this.push.send({
        userIds: [input.recipientId],
        title: content.title,
        body: content.body,
        link: content.link,
        logLabel: 'shared vault deletion result',
      });
    } catch (error) {
      this.logger.error(`Failed to dispatch shared vault deletion result: ${error}`);
    }
  }
}
