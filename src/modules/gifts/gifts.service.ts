import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, desc, eq, gt, isNull, lte } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { gifts, journeys, users } from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { requireJourneyOwner } from '../../shared/utils/journey-access.util';
import {
  CreateGiftInput,
  Gift,
  UpdateGiftInput,
} from './validations/gift.schema';

type GiftRow = typeof gifts.$inferSelect;

@Injectable()
export class GiftsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly notificationService: NotificationService,
  ) {}

  /** Section 1: only the Journey's owner can gift it — the same authority Section 4 of the Journeys spec already gives them. */
  async create(fromUserId: string, input: CreateGiftInput): Promise<Gift> {
    await requireJourneyOwner(this.db, fromUserId, input.journeyId);

    const unlockDate = new Date(input.unlockDate);
    if (unlockDate <= new Date()) {
      throw new ForbiddenException('The unlock date must be in the future.');
    }

    const [created] = await this.db
      .insert(gifts)
      .values({
        journeyId: input.journeyId,
        fromUserId,
        recipientEmail: input.recipientEmail,
        message: input.message,
        unlockDate,
      })
      .returning();
    return this.toDto(created);
  }

  async listSent(userId: string): Promise<Gift[]> {
    const rows = await this.db.query.gifts.findMany({
      where: eq(gifts.fromUserId, userId),
      orderBy: desc(gifts.createdAt),
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  /** Cancelled-before-delivery gifts are excluded — a recipient never needs to know a gift they never got existed. */
  async listReceived(userId: string): Promise<Gift[]> {
    const rows = await this.db.query.gifts.findMany({
      where: and(eq(gifts.toUserId, userId), isNull(gifts.cancelledAt)),
      orderBy: desc(gifts.createdAt),
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  /** Visible only to its sender or its resolved recipient — not even a shared family member otherwise. */
  async getById(userId: string, id: string): Promise<Gift> {
    const row = await this.requireVisible(userId, id);
    return this.toDto(row);
  }

  /** Section 8: editable only while still Pending — nothing has fired yet. */
  async update(
    userId: string,
    id: string,
    input: UpdateGiftInput,
  ): Promise<Gift> {
    const row = await this.requireSenderOwned(userId, id);
    this.requireStillPending(row);

    const unlockDate = input.unlockDate
      ? new Date(input.unlockDate)
      : undefined;
    if (unlockDate && unlockDate <= new Date()) {
      throw new ForbiddenException('The unlock date must be in the future.');
    }

    const [updated] = await this.db
      .update(gifts)
      .set({
        recipientEmail: input.recipientEmail,
        unlockDate,
        message: input.message,
        updatedAt: new Date(),
      })
      .where(eq(gifts.id, id))
      .returning();
    return this.toDto(updated);
  }

  async cancel(userId: string, id: string): Promise<Gift> {
    const row = await this.requireSenderOwned(userId, id);
    this.requireStillPending(row);

    const [updated] = await this.db
      .update(gifts)
      .set({ cancelledAt: new Date() })
      .where(eq(gifts.id, id))
      .returning();
    return this.toDto(updated);
  }

  /** Section 2: distinct from merely having access — the recipient actually viewing the reveal. */
  async markOpened(userId: string, id: string): Promise<Gift> {
    const row = await this.db.query.gifts.findFirst({
      where: eq(gifts.id, id),
    });
    if (!row || row.toUserId !== userId) {
      throw new NotFoundException('Gift not found');
    }
    if (row.firstOpenedAt) {
      return this.toDto(row);
    }
    const [updated] = await this.db
      .update(gifts)
      .set({ firstOpenedAt: new Date() })
      .where(eq(gifts.id, id))
      .returning();
    return this.toDto(updated);
  }

  /**
   * Called from AuthService right after account verification (Section 3/5:
   * "if they sign up with the matching email five years after the unlock
   * date, it should still deliver" — this is what makes that true even if
   * the unlock-sweep already ran and found nobody).
   */
  async resolveRecipientForEmail(userId: string, email: string): Promise<void> {
    await this.db
      .update(gifts)
      .set({ toUserId: userId })
      .where(
        and(
          eq(gifts.recipientEmail, email),
          isNull(gifts.toUserId),
          isNull(gifts.cancelledAt),
        ),
      );
  }

  /** Drives the onboarding-gate carve-out (Section 5) and a "you have something waiting" indicator for existing users. */
  async hasUnclaimedGift(userId: string): Promise<boolean> {
    const gift = await this.db.query.gifts.findFirst({
      where: and(
        eq(gifts.toUserId, userId),
        isNull(gifts.cancelledAt),
        isNull(gifts.firstOpenedAt),
        lte(gifts.unlockDate, new Date()),
      ),
    });
    return Boolean(gift);
  }

  /**
   * Section 7: the Journey's own deletion flow calls this — if the sender
   * deletes it before unlock, the Gift has nothing left to deliver and
   * should fail gracefully rather than ever attempt an invite/reveal for
   * content that no longer exists. Only still-pending gifts are touched —
   * one that already unlocked is a done deal regardless.
   */
  async cancelAllForJourney(journeyId: string): Promise<void> {
    await this.db
      .update(gifts)
      .set({ cancelledAt: new Date() })
      .where(
        and(
          eq(gifts.journeyId, journeyId),
          isNull(gifts.cancelledAt),
          gt(gifts.unlockDate, new Date()),
        ),
      );
  }

  /**
   * Section 3: "the system checks for Gifts whose unlock date has arrived
   * and processes each one." Server-time (UTC) cutoff for v1 — flagged in
   * the spec as a real, deliberate simplification, not an oversight.
   * Idempotent: inviteSentAt/unlockNotifiedAt ensure a gift is only ever
   * processed once, however often this runs.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processUnlocks(): Promise<void> {
    const due = await this.db.query.gifts.findMany({
      where: and(
        lte(gifts.unlockDate, new Date()),
        isNull(gifts.cancelledAt),
        isNull(gifts.inviteSentAt),
        isNull(gifts.unlockNotifiedAt),
      ),
    });

    for (const gift of due) {
      await this.processOne(gift);
    }
  }

  private async processOne(gift: GiftRow): Promise<void> {
    const [journey, sender] = await Promise.all([
      this.db.query.journeys.findFirst({
        where: eq(journeys.id, gift.journeyId),
      }),
      this.db.query.users.findFirst({ where: eq(users.id, gift.fromUserId) }),
    ]);
    if (!journey || !sender) return;

    const recipient = await this.db.query.users.findFirst({
      where: eq(users.email, gift.recipientEmail),
    });

    if (recipient) {
      await this.db
        .update(gifts)
        .set({ toUserId: recipient.id, unlockNotifiedAt: new Date() })
        .where(eq(gifts.id, gift.id));
      await this.notificationService.sendGiftUnlocked(
        gift.recipientEmail,
        sender.name,
        journey.title,
      );
    } else {
      await this.db
        .update(gifts)
        .set({ inviteSentAt: new Date() })
        .where(eq(gifts.id, gift.id));
      await this.notificationService.sendGiftInvite(
        gift.recipientEmail,
        sender.name,
        journey.title,
      );
    }
  }

  private requireStillPending(row: GiftRow): void {
    if (
      row.cancelledAt ||
      row.unlockDate <= new Date() ||
      row.inviteSentAt ||
      row.unlockNotifiedAt
    ) {
      throw new ForbiddenException(
        'This Gift has already been triggered and can no longer be edited or cancelled.',
      );
    }
  }

  private async requireSenderOwned(
    userId: string,
    id: string,
  ): Promise<GiftRow> {
    const row = await this.db.query.gifts.findFirst({
      where: eq(gifts.id, id),
    });
    if (!row || row.fromUserId !== userId) {
      throw new NotFoundException('Gift not found');
    }
    return row;
  }

  private async requireVisible(userId: string, id: string): Promise<GiftRow> {
    const row = await this.db.query.gifts.findFirst({
      where: eq(gifts.id, id),
    });
    if (!row || (row.fromUserId !== userId && row.toUserId !== userId)) {
      throw new NotFoundException('Gift not found');
    }
    return row;
  }

  private async toDto(row: GiftRow): Promise<Gift> {
    const [journey, sender] = await Promise.all([
      this.db.query.journeys.findFirst({
        where: eq(journeys.id, row.journeyId),
      }),
      this.db.query.users.findFirst({ where: eq(users.id, row.fromUserId) }),
    ]);

    return {
      id: row.id,
      journeyId: row.journeyId,
      journeyTitle: journey?.title ?? 'Untitled journey',
      fromUserId: row.fromUserId,
      fromUserName: sender?.name ?? 'Someone',
      recipientEmail: row.recipientEmail,
      toUserId: row.toUserId,
      message: row.message,
      unlockDate: row.unlockDate.toISOString(),
      status: this.computeStatus(row),
      recipientHasAccount: row.toUserId !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private computeStatus(row: GiftRow): Gift['status'] {
    if (row.cancelledAt) return 'cancelled';
    if (row.firstOpenedAt) return 'opened';
    if (row.unlockDate <= new Date()) return 'unlocked';
    return 'pending';
  }
}
