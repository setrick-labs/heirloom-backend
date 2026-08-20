import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { comments, media, milestones } from '../../database/schema';
import { requireJourneyAccess } from './journey-access.util';

/** Resolves a media row's owning journey, so the same access boundary as the journey/milestone applies. */
export async function requireMediaAccess(
  db: Database,
  userId: string,
  mediaId: string,
): Promise<typeof media.$inferSelect> {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row?.milestoneId) {
    throw new NotFoundException('Media not found');
  }
  const milestone = await db.query.milestones.findFirst({
    where: eq(milestones.id, row.milestoneId),
  });
  if (!milestone) {
    throw new NotFoundException('Media not found');
  }
  await requireJourneyAccess(db, userId, milestone.journeyId);
  return row;
}

/**
 * Individual-photo deletion is restricted to whoever uploaded it — not the
 * Milestone creator, not the Journey owner (Milestones functional spec,
 * Section 8: content someone else has already built a discussion around
 * isn't unilaterally someone else's to remove).
 */
export async function requireMediaOwner(
  db: Database,
  userId: string,
  mediaId: string,
): Promise<typeof media.$inferSelect> {
  const row = await requireMediaAccess(db, userId, mediaId);
  if (row.ownerId !== userId) {
    throw new ForbiddenException('Only whoever uploaded this can remove it');
  }
  return row;
}

/**
 * Comments/reactions are polymorphic (see database/schema/enums.ts). The
 * client drives 'media' for comments (Milestones spec Section 3/9: scoped to
 * a single image/video, never the milestone as a whole) and 'comment' for
 * likes on those comments, but the check stays generic since the schema
 * itself is.
 */
export async function requireTargetAccess(
  db: Database,
  userId: string,
  targetType: 'milestone' | 'media' | 'moment' | 'event' | 'comment',
  targetId: string,
): Promise<void> {
  if (targetType === 'comment') {
    // A comment has no access rules of its own — it inherits whatever guards
    // the thing it was written on. Liking a comment is exactly as permitted
    // as seeing the photo it sits under.
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, targetId),
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    await requireTargetAccess(
      db,
      userId,
      comment.targetType,
      comment.targetId,
    );
    return;
  }
  if (targetType === 'media') {
    await requireMediaAccess(db, userId, targetId);
    return;
  }
  if (targetType === 'milestone') {
    const milestone = await db.query.milestones.findFirst({
      where: eq(milestones.id, targetId),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await requireJourneyAccess(db, userId, milestone.journeyId);
    return;
  }
  throw new NotFoundException('Unsupported target');
}
