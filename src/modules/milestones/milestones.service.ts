import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, ne } from 'drizzle-orm';

import { env } from '../../config/env';
import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  comments,
  journeys,
  media,
  milestones,
  reactions,
} from '../../database/schema';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import {
  CreateMilestoneInput,
  Milestone,
  RenameMilestoneInput,
} from './validations/milestone.schema';

type MilestoneRow = typeof milestones.$inferSelect;
type JourneyRow = typeof journeys.$inferSelect;

@Injectable()
export class MilestonesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  /** Section 1: any visibility member, not owner-gated; requires the first media atomically. */
  async create(
    userId: string,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    await requireJourneyAccess(this.db, userId, input.journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, input.journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }

    const date = input.date ? new Date(input.date) : new Date();
    const title = input.title?.trim() || formatDateLabel(date);

    const milestone = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(milestones)
        .values({
          id: input.id,
          journeyId: input.journeyId,
          title,
          description: input.description,
          date,
          location: input.location,
          createdBy: userId,
        })
        .returning();

      await tx.insert(media).values({
        familyId: journey.familyId,
        milestoneId: created.id,
        ownerId: userId,
        type: input.media.type,
        storageKey: input.media.key,
        caption: input.media.caption,
        sizeBytes: input.media.sizeBytes,
      });

      return created;
    });

    return this.withComputedFields(userId, journey, milestone);
  }

  /** Chronological by memory date (Section 6), not upload order. */
  async listByJourney(userId: string, journeyId: string): Promise<Milestone[]> {
    await requireJourneyAccess(this.db, userId, journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Journey not found');
    }

    const rows = await this.db.query.milestones.findMany({
      where: and(
        eq(milestones.journeyId, journeyId),
        isNull(milestones.deletedAt),
      ),
      orderBy: asc(milestones.date),
    });
    return Promise.all(
      rows.map((row) => this.withComputedFields(userId, journey, row)),
    );
  }

  async findById(userId: string, id: string): Promise<Milestone> {
    const milestone = await this.db.query.milestones.findFirst({
      where: and(eq(milestones.id, id), isNull(milestones.deletedAt)),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await requireJourneyAccess(this.db, userId, milestone.journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, milestone.journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Milestone not found');
    }
    return this.withComputedFields(userId, journey, milestone);
  }

  /** Section 8: creator or the journey's owner. */
  async rename(
    userId: string,
    id: string,
    input: RenameMilestoneInput,
  ): Promise<Milestone> {
    const { milestone, journey } = await this.requireManage(userId, id);
    const [updated] = await this.db
      .update(milestones)
      .set({ title: input.title, updatedAt: new Date() })
      .where(eq(milestones.id, milestone.id))
      .returning();
    return this.withComputedFields(userId, journey, updated);
  }

  /** Section 8: creator or journey owner, soft-delete with a grace period. */
  async initiateDelete(userId: string, id: string): Promise<Milestone> {
    const { milestone, journey } = await this.requireManage(userId, id);
    const [updated] = await this.db
      .update(milestones)
      .set({ deletedAt: new Date() })
      .where(eq(milestones.id, milestone.id))
      .returning();
    return this.withComputedFields(userId, journey, updated);
  }

  async cancelDelete(userId: string, id: string): Promise<Milestone> {
    const milestone = await this.db.query.milestones.findFirst({
      where: eq(milestones.id, id),
    });
    if (!milestone?.deletedAt) {
      throw new NotFoundException('This milestone is not pending deletion.');
    }
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, milestone.journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Milestone not found');
    }
    if (milestone.createdBy !== userId && journey.createdBy !== userId) {
      throw new ForbiddenException(
        'Only the creator or journey owner can do that',
      );
    }

    const graceDeadline = new Date(
      milestone.deletedAt.getTime() +
        env.MILESTONE_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
    );
    if (graceDeadline <= new Date()) {
      throw new ForbiddenException(
        'The recovery window for this milestone has passed.',
      );
    }

    const [updated] = await this.db
      .update(milestones)
      .set({ deletedAt: null })
      .where(eq(milestones.id, id))
      .returning();
    return this.withComputedFields(userId, journey, updated);
  }

  private async requireManage(
    userId: string,
    id: string,
  ): Promise<{ milestone: MilestoneRow; journey: JourneyRow }> {
    const milestone = await this.db.query.milestones.findFirst({
      where: and(eq(milestones.id, id), isNull(milestones.deletedAt)),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await requireJourneyAccess(this.db, userId, milestone.journeyId);
    const journey = await this.db.query.journeys.findFirst({
      where: eq(journeys.id, milestone.journeyId),
    });
    if (!journey) {
      throw new NotFoundException('Milestone not found');
    }
    if (milestone.createdBy !== userId && journey.createdBy !== userId) {
      throw new ForbiddenException(
        'Only the creator or journey owner can do that',
      );
    }
    return { milestone, journey };
  }

  private async withComputedFields(
    viewerId: string,
    journey: JourneyRow,
    row: MilestoneRow,
  ): Promise<Milestone> {
    const mediaRows = await this.db
      .select({
        id: media.id,
        createdAt: media.createdAt,
        ownerId: media.ownerId,
      })
      .from(media)
      .where(eq(media.milestoneId, row.id));
    const mediaIds = mediaRows.map((m) => m.id);

    const [{ value: reactionCount }] = mediaIds.length
      ? await this.db
          .select({ value: count() })
          .from(reactions)
          .where(
            and(
              eq(reactions.targetType, 'media'),
              inArray(reactions.targetId, mediaIds),
            ),
          )
      : [{ value: 0 }];

    const otherMediaTimestamps = mediaRows
      .filter((m) => m.ownerId !== viewerId)
      .map((m) => m.createdAt);

    const otherComments = mediaIds.length
      ? await this.db
          .select({ createdAt: comments.createdAt })
          .from(comments)
          .where(
            and(
              eq(comments.targetType, 'media'),
              inArray(comments.targetId, mediaIds),
              ne(comments.authorId, viewerId),
            ),
          )
      : [];
    const otherReactions = mediaIds.length
      ? await this.db
          .select({ createdAt: reactions.createdAt })
          .from(reactions)
          .where(
            and(
              eq(reactions.targetType, 'media'),
              inArray(reactions.targetId, mediaIds),
              ne(reactions.userId, viewerId),
            ),
          )
      : [];

    const activityTimestamps = [
      ...otherMediaTimestamps,
      ...otherComments.map((c) => c.createdAt),
      ...otherReactions.map((r) => r.createdAt),
      ...(row.createdBy !== viewerId ? [row.updatedAt] : []),
    ];
    const lastOtherActivityAt = activityTimestamps.length
      ? new Date(Math.max(...activityTimestamps.map((d) => d.getTime())))
      : null;

    return this.toDto(
      viewerId,
      row,
      journey,
      mediaIds,
      reactionCount,
      lastOtherActivityAt,
    );
  }

  private toDto(
    viewerId: string,
    row: MilestoneRow,
    journey: JourneyRow,
    mediaIds: string[],
    reactionCount: number,
    lastOtherActivityAt: Date | null,
  ): Milestone {
    const deletedAt = row.deletedAt;
    return {
      id: row.id,
      journeyId: row.journeyId,
      title: row.title,
      description: row.description,
      date: row.date.toISOString(),
      location: row.location,
      mediaIds,
      reactionCount,
      lastOtherActivityAt: lastOtherActivityAt
        ? lastOtherActivityAt.toISOString()
        : null,
      createdBy: row.createdBy,
      canManage: row.createdBy === viewerId || journey.createdBy === viewerId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: deletedAt ? deletedAt.toISOString() : null,
      purgeAt: deletedAt
        ? new Date(
            deletedAt.getTime() +
              env.MILESTONE_DELETION_GRACE_PERIOD_DAYS * 86_400_000,
          ).toISOString()
        : null,
    };
  }
}

/** e.g. "March 15, 2024" — the fallback label when a Milestone's title is left blank (Section 1). */
function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
