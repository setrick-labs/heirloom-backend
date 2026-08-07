import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, lte } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { gifts, journeyMembers, journeys } from '../../database/schema';
import { isActiveFamilyMember } from './family-membership.util';

/**
 * Section 2/8: visibility is enforced here, at the data layer — every read
 * or write that touches a journey (or its milestones) must route through
 * this, not just hide things in the UI. Two independent ways in: ordinary
 * family visibility (member first, then owner/'all'/'selected'-list), or —
 * Gifting spec Section 6/10 — a delivered Gift, which grants full
 * participant access to this one Journey without family membership at all.
 * Neither path needs the other; a gift recipient with no family in common
 * still gets in via canAccessJourneyViaGift below.
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

  if (await isActiveFamilyMember(db, userId, journey.familyId)) {
    if (journey.createdBy === userId || journey.visibilityType === 'all') {
      return true;
    }
    const membership = await db.query.journeyMembers.findFirst({
      where: and(
        eq(journeyMembers.journeyId, journeyId),
        eq(journeyMembers.userId, userId),
      ),
    });
    if (membership) {
      return true;
    }
  }

  return canAccessJourneyViaGift(db, userId, journeyId);
}

/**
 * Gifting spec Section 7's cross-cutting rule: "Gift delivery is
 * independent of ordinary family visibility rules." A gift only grants
 * access once its unlock date has actually passed and it hasn't been
 * cancelled — deliberately re-checked live rather than trusting a stored
 * flag, same reasoning as the derived status in gifts.service.ts.
 */
async function canAccessJourneyViaGift(
  db: Database,
  userId: string,
  journeyId: string,
): Promise<boolean> {
  const gift = await db.query.gifts.findFirst({
    where: and(
      eq(gifts.journeyId, journeyId),
      eq(gifts.toUserId, userId),
      isNull(gifts.cancelledAt),
      lte(gifts.unlockDate, new Date()),
    ),
  });
  return Boolean(gift);
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
