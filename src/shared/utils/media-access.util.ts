import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { media, milestones } from '../../database/schema';
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
 * Comments/reactions are polymorphic (target 'milestone' or 'media' — see
 * database/schema/enums.ts). This module only ever drives targetType
 * 'media' from the client (Milestones spec Section 3/9: scoped to a single
 * image/video, never the milestone as a whole), but the check stays generic
 * since the schema itself is.
 */
export async function requireTargetAccess(
  db: Database,
  userId: string,
  targetType: 'milestone' | 'media' | 'moment' | 'event',
  targetId: string,
): Promise<void> {
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
