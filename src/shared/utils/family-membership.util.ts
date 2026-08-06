import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { familyMembers, families } from '../../database/schema';

/** Pure helpers over family_members — usable from any service without cross-module DI. */

/**
 * Raw membership row, regardless of whether the family is soft-deleted.
 * Deliberately used by families.service.ts's cancelDelete — an admin must
 * still be recognized as a member of their own pending-deletion family to
 * restore it. Everywhere else, prefer isActiveFamilyMember below.
 */
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
 * Membership that also requires the family not be soft-deleted (Section 7:
 * "all members lose access the moment deletion is initiated"). This is what
 * normal access checks should use — family_members rows deliberately
 * survive a soft-delete (so cancel-deletion can restore access), so plain
 * isFamilyMember alone isn't enough to gate everyday access.
 */
export async function isActiveFamilyMember(
  db: Database,
  userId: string,
  familyId: string,
): Promise<boolean> {
  return (
    (await isFamilyMember(db, userId, familyId)) &&
    (await isFamilyActive(db, familyId))
  );
}

export async function isFamilyActive(
  db: Database,
  familyId: string,
): Promise<boolean> {
  const family = await db.query.families.findFirst({
    where: and(eq(families.id, familyId), isNull(families.deletedAt)),
  });
  return Boolean(family);
}

/**
 * Resolves which family should be "active" for a user: keeps their stored
 * choice if it's still a valid, non-deleted membership, otherwise falls back
 * to any other family they belong to, or null if they belong to none
 * (Section 6 edge case — e.g. they were removed from what had been their
 * active family, or it was deleted).
 */
export async function resolveActiveFamilyId(
  db: Database,
  userId: string,
  storedActiveFamilyId: string | null,
): Promise<string | null> {
  if (
    storedActiveFamilyId &&
    (await isActiveFamilyMember(db, userId, storedActiveFamilyId))
  ) {
    return storedActiveFamilyId;
  }

  const memberships = await db.query.familyMembers.findMany({
    where: eq(familyMembers.userId, userId),
  });
  for (const membership of memberships) {
    if (await isFamilyActive(db, membership.familyId)) {
      return membership.familyId;
    }
  }
  return null;
}
