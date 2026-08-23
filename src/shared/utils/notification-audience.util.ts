import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import {
  familyMembers,
  journeyMembers,
  journeys,
  users,
} from '../../database/schema';

/**
 * The five categories on the Notifications screen (Screen 36), and the
 * `users` column each one is stored in.
 *
 * `versions` is its own category rather than a flavour of `comments`
 * because "someone added their take on your photo" is a different event to
 * "someone replied to you", even though both are rows in the comments table
 * (see commentTypeEnum — 'version' is how that feature reuses it).
 */
export const NOTIFICATION_PREFERENCE_COLUMNS = {
  memories: users.notifyMemories,
  comments: users.notifyComments,
  versions: users.notifyVersions,
  invites: users.notifyInvites,
  gifts: users.notifyGifts,
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_PREFERENCE_COLUMNS;

/**
 * Everyone who can see a Journey, minus whoever caused the event.
 *
 * Mirrors the visibility rule in journey-access.util.ts rather than inventing
 * a second one: 'all' means the whole family, 'selected' means the explicit
 * member list plus the owner (who is never in that list). Getting this wrong
 * in the *notification* path would leak the existence of private content to
 * people who cannot open it — a notification about a journey you can't see is
 * still a disclosure — so it deliberately re-derives the audience from the
 * same tables rather than trusting a cached list.
 *
 * Gift recipients are excluded by construction: they reach a Journey through
 * a delivered gift rather than membership, and a gift is announced by its own
 * notification, once, on the day it unlocks.
 */
export async function getJourneyAudience(
  db: Database,
  journeyId: string,
  excludeUserId: string,
): Promise<string[]> {
  const journey = await db.query.journeys.findFirst({
    where: and(eq(journeys.id, journeyId), isNull(journeys.deletedAt)),
  });
  if (!journey) return [];

  let userIds: string[];

  if (journey.visibilityType === 'all') {
    const rows = await db.query.familyMembers.findMany({
      where: eq(familyMembers.familyId, journey.familyId),
    });
    userIds = rows.map((row) => row.userId);
  } else {
    const rows = await db.query.journeyMembers.findMany({
      where: eq(journeyMembers.journeyId, journeyId),
    });
    userIds = rows.map((row) => row.userId);
    if (!userIds.includes(journey.createdBy)) {
      userIds.push(journey.createdBy);
    }
  }

  // Your own upload never notifies you — the same rule the unread badges
  // already follow (see unread-counts.util.ts).
  return userIds.filter((id) => id !== excludeUserId);
}

/** Everyone in a family except whoever caused the event. */
export async function getFamilyAudience(
  db: Database,
  familyId: string,
  excludeUserId: string,
): Promise<string[]> {
  const rows = await db.query.familyMembers.findMany({
    where: eq(familyMembers.familyId, familyId),
  });
  return rows.map((row) => row.userId).filter((id) => id !== excludeUserId);
}

/**
 * Narrows an audience to those who still want this kind of notification.
 *
 * Applied server-side, immediately before sending, rather than as OneSignal
 * tags or a client-side filter. A preference that lives only on the device is
 * one a reinstall forgets, and one that lives only as a provider tag is one
 * we cannot reason about or test. This is also the last line of defence: a
 * push that has left the building cannot be un-sent.
 */
export async function filterByPreference(
  db: Database,
  userIds: string[],
  category: NotificationCategory,
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const rows = await db.query.users.findMany({
    columns: { id: true },
    where: and(
      inArray(users.id, userIds),
      eq(NOTIFICATION_PREFERENCE_COLUMNS[category], true),
    ),
  });
  return rows.map((row) => row.id);
}
