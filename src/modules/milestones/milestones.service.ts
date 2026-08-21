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
import { StorageService } from '../../shared/services/storage.service';
import { resolveStoredImageUrl } from '../../shared/utils/cover-url.util';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import { getUnreadCountsByMilestone } from '../../shared/utils/unread-counts.util';
import { MediaProcessingService } from '../media/media-processing.service';
import {
  CreateMilestoneInput,
  Milestone,
  RenameMilestoneInput,
} from './validations/milestone.schema';

type MilestoneRow = typeof milestones.$inferSelect;
type JourneyRow = typeof journeys.$inferSelect;

/**
 * Milestone counts the flow renders as literal copy on Screen 24's header
 * ("12 memories · 3 contributors") and as the grid's unread badge. Kept
 * separate from the positional params above because these two are the ones
 * that get added to over time.
 */
interface MilestoneComputedFields {
  /** Distinct people who have contributed a Memory here. */
  contributorCount: number;
  /** Memories from other people since this viewer last opened this milestone. */
  unreadCount: number;
  /** Up to three thumbnail URLs, newest first — the timeline card's peek. */
  previewThumbnails: string[];
  /** Presigned from coverStorageKey, else the plain column. */
  coverImageUrl: string | null;
}

/** How many thumbnails the timeline card shows before it says "+N more". */
const PREVIEW_THUMBNAILS = 3;

/** A media row reduced to what a preview thumbnail needs. */
interface PreviewSource {
  createdAt: Date;
  storageKey: string;
  thumbnailStorageKey: string | null;
}

@Injectable()
export class MilestonesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly mediaProcessingService: MediaProcessingService,
    private readonly storageService: StorageService,
  ) {}

  /** Section 1: any visibility member, not owner-gated. */
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
    const media_ = input.media;

    const { milestone, createdMedia } = await this.db.transaction(
      async (tx) => {
        const [created] = await tx
          .insert(milestones)
          .values({
            ...(input.id ? { id: input.id } : {}),
            journeyId: input.journeyId,
            title,
            description: input.description,
            date,
            location: input.location,
            createdBy: userId,
          })
          .returning();

        if (!media_) {
          return { milestone: created, createdMedia: null };
        }

        const [createdMedia] = await tx
          .insert(media)
          .values({
            familyId: journey.familyId,
            milestoneId: created.id,
            ownerId: userId,
            type: media_.type,
            storageKey: media_.key,
            caption: media_.caption,
            sizeBytes: media_.sizeBytes,
            processingStatus: media_.type === 'image' ? 'pending' : undefined,
          })
          .returning();

        return { milestone: created, createdMedia };
      },
    );

    // Fire-and-forget — same reasoning as MediaService.create(). Only
    // present when the caller supplied a first memory atomically; the
    // ordinary path adds media afterward through MediaService.create.
    if (createdMedia && media_) {
      void this.mediaProcessingService.processAndPersist(
        createdMedia.id,
        createdMedia.storageKey,
        media_.type,
      );
    }

    return this.withComputedFields(userId, journey, milestone);
  }

  /**
   * Chronological by memory date (Section 6), not upload order.
   *
   * Batched rather than delegating to withComputedFields per row — that
   * path does 4 sequential queries per milestone (media, reaction count,
   * other-comments, other-reactions), which was a genuine N+1: an 8-
   * milestone journey meant 32 round trips just to render the map. Here
   * everything is fetched in at most 4 queries total for the whole journey
   * and grouped in memory by milestoneId/mediaId.
   */
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
    if (rows.length === 0) return [];

    const milestoneIds = rows.map((row) => row.id);
    const mediaRows = await this.db
      .select({
        id: media.id,
        milestoneId: media.milestoneId,
        createdAt: media.createdAt,
        ownerId: media.ownerId,
        // For the card's preview strip. Taken from the query that was already
        // being made rather than a second one — this list is deliberately
        // four queries total for a whole journey, and it stays that way.
        storageKey: media.storageKey,
        thumbnailStorageKey: media.thumbnailStorageKey,
      })
      .from(media)
      .where(inArray(media.milestoneId, milestoneIds));

    const mediaIdsByMilestoneId = new Map<string, string[]>();
    const mediaIdToMilestoneId = new Map<string, string>();
    for (const m of mediaRows) {
      if (!m.milestoneId) continue;
      mediaIdToMilestoneId.set(m.id, m.milestoneId);
      const list = mediaIdsByMilestoneId.get(m.milestoneId);
      if (list) list.push(m.id);
      else mediaIdsByMilestoneId.set(m.milestoneId, [m.id]);
    }
    const allMediaIds = mediaRows.map((m) => m.id);

    const [reactionCounts, otherComments, otherReactions] = allMediaIds.length
      ? await Promise.all([
          this.db
            .select({ targetId: reactions.targetId, value: count() })
            .from(reactions)
            .where(
              and(
                eq(reactions.targetType, 'media'),
                inArray(reactions.targetId, allMediaIds),
              ),
            )
            .groupBy(reactions.targetId),
          this.db
            .select({
              targetId: comments.targetId,
              createdAt: comments.createdAt,
            })
            .from(comments)
            .where(
              and(
                eq(comments.targetType, 'media'),
                inArray(comments.targetId, allMediaIds),
                ne(comments.authorId, userId),
              ),
            ),
          this.db
            .select({
              targetId: reactions.targetId,
              createdAt: reactions.createdAt,
            })
            .from(reactions)
            .where(
              and(
                eq(reactions.targetType, 'media'),
                inArray(reactions.targetId, allMediaIds),
                ne(reactions.userId, userId),
              ),
            ),
        ])
      : [[], [], []];

    const reactionCountByMilestoneId = new Map<string, number>();
    for (const r of reactionCounts) {
      const milestoneId = mediaIdToMilestoneId.get(r.targetId);
      if (!milestoneId) continue;
      reactionCountByMilestoneId.set(
        milestoneId,
        (reactionCountByMilestoneId.get(milestoneId) ?? 0) + r.value,
      );
    }

    const activityTimestampsByMilestoneId = new Map<string, Date[]>();
    const pushActivity = (milestoneId: string | undefined, date: Date) => {
      if (!milestoneId) return;
      const list = activityTimestampsByMilestoneId.get(milestoneId);
      if (list) list.push(date);
      else activityTimestampsByMilestoneId.set(milestoneId, [date]);
    };
    for (const m of mediaRows) {
      if (m.ownerId !== userId)
        pushActivity(m.milestoneId ?? undefined, m.createdAt);
    }
    for (const c of otherComments) {
      pushActivity(mediaIdToMilestoneId.get(c.targetId), c.createdAt);
    }
    for (const r of otherReactions) {
      pushActivity(mediaIdToMilestoneId.get(r.targetId), r.createdAt);
    }

    // "12 memories · 3 contributors" (Screen 24) — derived from mediaRows,
    // which is already loaded above, rather than a second grouped query.
    const contributorsByMilestoneId = new Map<string, Set<string>>();
    for (const m of mediaRows) {
      if (!m.milestoneId) continue;
      const set = contributorsByMilestoneId.get(m.milestoneId);
      if (set) set.add(m.ownerId);
      else contributorsByMilestoneId.set(m.milestoneId, new Set([m.ownerId]));
    }

    const unreadByMilestoneId = await getUnreadCountsByMilestone(
      this.db,
      userId,
      milestoneIds,
    );

    const previewsByMilestoneId = new Map<string, PreviewSource[]>();
    for (const m of mediaRows) {
      if (!m.milestoneId) continue;
      const list = previewsByMilestoneId.get(m.milestoneId);
      if (list) list.push(m);
      else previewsByMilestoneId.set(m.milestoneId, [m]);
    }

    // Presigning is a local signature, not a round trip, so this stays inside
    // the four-query budget the batching above exists to protect.
    const [previewsByRow, coversByRow] = await Promise.all([
      Promise.all(
        rows.map((row) =>
          this.resolvePreviewThumbnails(previewsByMilestoneId.get(row.id) ?? []),
        ),
      ),
      Promise.all(rows.map((row) => this.resolveCover(row))),
    ]);

    return rows.map((row, index) => {
      const timestamps = [
        ...(activityTimestampsByMilestoneId.get(row.id) ?? []),
      ];
      if (row.createdBy !== userId) timestamps.push(row.updatedAt);
      const lastOtherActivityAt = timestamps.length
        ? new Date(Math.max(...timestamps.map((d) => d.getTime())))
        : null;
      return this.toDto(
        userId,
        row,
        journey,
        mediaIdsByMilestoneId.get(row.id) ?? [],
        reactionCountByMilestoneId.get(row.id) ?? 0,
        lastOtherActivityAt,
        {
          contributorCount: contributorsByMilestoneId.get(row.id)?.size ?? 0,
          unreadCount: unreadByMilestoneId.get(row.id) ?? 0,
          previewThumbnails: previewsByRow[index] ?? [],
          coverImageUrl: coversByRow[index] ?? null,
        },
      );
    });
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
    // Spread only the keys actually present, so an omitted field is left
    // alone while an explicit null still clears it.
    const [updated] = await this.db
      .update(milestones)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.coverStorageKey !== undefined
          ? { coverStorageKey: input.coverStorageKey }
          : {}),
        updatedAt: new Date(),
      })
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
        storageKey: media.storageKey,
        thumbnailStorageKey: media.thumbnailStorageKey,
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

    const unreadByMilestoneId = await getUnreadCountsByMilestone(
      this.db,
      viewerId,
      [row.id],
    );

    return this.toDto(
      viewerId,
      row,
      journey,
      mediaIds,
      reactionCount,
      lastOtherActivityAt,
      {
        contributorCount: new Set(mediaRows.map((m) => m.ownerId)).size,
        unreadCount: unreadByMilestoneId.get(row.id) ?? 0,
        previewThumbnails: await this.resolvePreviewThumbnails(mediaRows),
        coverImageUrl: await this.resolveCover(row),
      },
    );
  }

  /**
   * Newest first, capped at three.
   *
   * Falls back to the original key when a thumbnail variant is missing — an
   * image whose processing pass hasn't run yet, or non-image media — which is
   * the same fallback MediaService.toDto makes for a single item.
   */
  private resolvePreviewThumbnails(sources: PreviewSource[]): Promise<string[]> {
    return Promise.all(
      [...sources]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, PREVIEW_THUMBNAILS)
        .map((m) =>
          this.storageService.generatePresignedDownloadUrl(
            m.thumbnailStorageKey ?? m.storageKey,
          ),
        ),
    );
  }

  private resolveCover(row: MilestoneRow): Promise<string | null> {
    return resolveStoredImageUrl(
      this.storageService,
      row.coverStorageKey,
      row.coverImageUrl,
    );
  }

  private toDto(
    viewerId: string,
    row: MilestoneRow,
    journey: JourneyRow,
    mediaIds: string[],
    reactionCount: number,
    lastOtherActivityAt: Date | null,
    computed: MilestoneComputedFields,
  ): Milestone {
    const deletedAt = row.deletedAt;
    return {
      id: row.id,
      journeyId: row.journeyId,
      title: row.title,
      description: row.description,
      date: row.date.toISOString(),
      location: row.location,
      coverImageUrl: computed.coverImageUrl,
      mediaIds,
      previewThumbnails: computed.previewThumbnails,
      reactionCount,
      memoryCount: mediaIds.length,
      contributorCount: computed.contributorCount,
      unreadCount: computed.unreadCount,
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
