import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { journeyMembers, journeys } from '../../database/schema';
import { isActiveFamilyMember } from './family-membership.util';

/**
 * Section 2/8: visibility is enforced here, at the data layer — every read
 * or write that touches a journey (or its milestones) must route through
 * this, not just hide things in the UI. A person must be a *current, active*
 * family member first (this is also what makes family removal cascade into
 * losing journey access automatically, per Section 3 — including for an
 * owner who's removed from the family). Then: the owner always has access
 * to their own journey regardless of the 'selected' list (Section 3: "an
 * owner shouldn't be able to lock themselves out of something they
 * created"), or the journey is 'all' (dynamic), or they're on the list.
 */
export async function canAccessJourney(
  db: Database,
  userId: string,
  journeyId: string,
): Promise<boolean> {
  const journey = await db.query.journeys.findFirst({
    where: and(eq(journeys.id, journeyId), isNull(journeys.deletedAt)),
  });
  if (!journey) {
    return false;
  }
  if (!(await isActiveFamilyMember(db, userId, journey.familyId))) {
    return false;
  }
  if (journey.createdBy === userId || journey.visibilityType === 'all') {
    return true;
  }

  const membership = await db.query.journeyMembers.findFirst({
    where: and(
      eq(journeyMembers.journeyId, journeyId),
      eq(journeyMembers.userId, userId),
    ),
  });
  return Boolean(membership);
}

/** Same NOT_FOUND either way (no access vs. doesn't exist) — existence itself is part of what's hidden. */
export async function requireJourneyAccess(
  db: Database,
  userId: string,
  journeyId: string,
): Promise<void> {
  if (!(await canAccessJourney(db, userId, journeyId))) {
    throw new NotFoundException('Journey not found');
  }
}

/**
 * Owner-only actions require both current access (so a removed former-owner
 * can't act on a journey they've lost all access to) and createdBy match.
 */
export async function requireJourneyOwner(
  db: Database,
  userId: string,
  journeyId: string,
): Promise<void> {
  await requireJourneyAccess(db, userId, journeyId);
  const journey = await db.query.journeys.findFirst({
    where: eq(journeys.id, journeyId),
  });
  if (journey?.createdBy !== userId) {
    throw new ForbiddenException('Only this journey’s owner can do that');
  }
}
