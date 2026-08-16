import { and, count, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { contentViews, media, milestones } from '../../database/schema';

/**
 * Unread Memory counts, as the numeric badge the flow puts on a Journey
 * cover (Screen 17) and a Milestone card (Screen 20).
 *
 * Two rules, both from the design:
 *  - "unseen Memories since your last visit" — anything created after this
 *    viewer's content_views watermark, or everything if they have no
 *    watermark yet (never opened it).
 *  - your own uploads never count. Milestones spec Section 7 already
 *    establishes this for the existing lastOtherActivityAt field; the same
 *    rule has to hold here or your own capture would badge itself.
 *
 * Both helpers batch: one query for N targets, via a LEFT JOIN onto the
 * watermark rather than a per-target lookup. The surrounding list endpoints
 * were explicitly de-N+1'd already (see journeys.service.ts's batched count
 * + max query) and this keeps that property.
 */

/** Unread count per journey id. Journeys with nothing unread are absent from the map, not zero-filled. */
export async function getUnreadCountsByJourney(
  db: Database,
  viewerId: string,
  journeyIds: string[],
): Promise<Map<string, number>> {
  if (journeyIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ journeyId: milestones.journeyId, value: count() })
    .from(media)
    .innerJoin(milestones, eq(media.milestoneId, milestones.id))
    .leftJoin(
      contentViews,
      and(
        eq(contentViews.userId, viewerId),
        eq(contentViews.targetType, 'journey'),
        eq(contentViews.targetId, milestones.journeyId),
      ),
    )
    .where(
      and(
        inArray(milestones.journeyId, journeyIds),
        isNull(milestones.deletedAt),
        ne(media.ownerId, viewerId),
        or(
          isNull(contentViews.lastSeenAt),
          gt(media.createdAt, contentViews.lastSeenAt),
        ),
      ),
    )
    .groupBy(milestones.journeyId);

  return new Map(rows.map((row) => [row.journeyId, row.value]));
}

/** Unread count per milestone id. Same rules as above, scoped one level down. */
export async function getUnreadCountsByMilestone(
  db: Database,
  viewerId: string,
  milestoneIds: string[],
): Promise<Map<string, number>> {
  if (milestoneIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ milestoneId: media.milestoneId, value: count() })
    .from(media)
    .leftJoin(
      contentViews,
      and(
        eq(contentViews.userId, viewerId),
        eq(contentViews.targetType, 'milestone'),
        eq(contentViews.targetId, media.milestoneId),
      ),
    )
    .where(
      and(
        inArray(media.milestoneId, milestoneIds),
        ne(media.ownerId, viewerId),
        or(
          isNull(contentViews.lastSeenAt),
          gt(media.createdAt, contentViews.lastSeenAt),
        ),
      ),
    )
    .groupBy(media.milestoneId);

  return new Map(
    rows.flatMap((row) =>
      row.milestoneId ? [[row.milestoneId, row.value] as const] : [],
    ),
  );
}
