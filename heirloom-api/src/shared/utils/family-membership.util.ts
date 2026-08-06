import { and, eq } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { familyMembers } from '../../database/schema';

/** Pure helpers over family_members — usable from any service without cross-module DI. */

export async function getFamilyMembership(
  db: Database,
  userId: string,
  familyId: string,
) {
  return db.query.familyMembers.findFirst({
    where: and(
      eq(familyMembers.userId, userId),
      eq(familyMembers.familyId, familyId),
    ),
  });
}

export async function isFamilyMember(
  db: Database,
  userId: string,
  familyId: string,
): Promise<boolean> {
  return Boolean(await getFamilyMembership(db, userId, familyId));
}

/**
 * Resolves which family should be "active" for a user: keeps their stored
 * choice if it's still a valid membership, otherwise falls back to any
 * family they belong to, or null if they belong to none (Section 6 edge case
 * — e.g. they were removed from what had been their active family).
 */
export async function resolveActiveFamilyId(
  db: Database,
  userId: string,
  storedActiveFamilyId: string | null,
): Promise<string | null> {
  if (
    storedActiveFamilyId &&
    (await isFamilyMember(db, userId, storedActiveFamilyId))
  ) {
    return storedActiveFamilyId;
  }

  const anyMembership = await db.query.familyMembers.findFirst({
    where: eq(familyMembers.userId, userId),
  });
  return anyMembership?.familyId ?? null;
}
