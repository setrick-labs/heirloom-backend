/**
 * The rules of a shared vault, as pure functions — no database, no Nest —
 * so the parts that decide whether something shared gets deleted can be
 * tested exhaustively on their own.
 */

/** A shared vault is a small circle, not a family-wide album. */
export const MAX_SHARED_VAULT_MEMBERS = 8;

/** The uploader's "wrong photo" window: delete alone, no vote needed. */
export const UNDO_WINDOW_MS = 15 * 60 * 1000;

/** How long everyone has to answer a deletion request before it lapses. */
export const DELETION_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Vote = { userId: string; approve: boolean };

export type DeletionOutcome = 'pending' | 'approved' | 'declined';

/**
 * Who has to agree: every *active* member except whoever asked.
 *
 * Invitees don't vote — they can't see inside yet, and asking someone to
 * approve deleting a photo they've never been able to look at is not
 * consent. Derived from current membership each time, so a member leaving
 * mid-request removes their vote from what's owed rather than stranding it.
 */
export function requiredApprovers(
  activeMemberIds: readonly string[],
  requesterId: string,
): string[] {
  return activeMemberIds.filter((id) => id !== requesterId);
}

/**
 * Where a request stands. Any single "keep" declines it outright — mutual
 * delete means everyone agrees, so one objection is enough to keep the
 * memory. Votes from people who are no longer active members are ignored.
 */
export function deletionOutcome(
  activeMemberIds: readonly string[],
  requesterId: string,
  votes: readonly Vote[],
): DeletionOutcome {
  const required = requiredApprovers(activeMemberIds, requesterId);
  const relevant = votes.filter((vote) => required.includes(vote.userId));

  if (relevant.some((vote) => !vote.approve)) return 'declined';
  const approvedBy = new Set(
    relevant.filter((vote) => vote.approve).map((vote) => vote.userId),
  );
  return required.every((id) => approvedBy.has(id)) ? 'approved' : 'pending';
}

/**
 * Whether one person may delete an item on their own, without a vote.
 *
 * Two cases. Their own upload, inside the undo window — a mistake caught
 * immediately shouldn't need a committee. Or they are the only active member
 * left, where "everyone agrees" is just them.
 */
export function canDeleteItemAlone(input: {
  userId: string;
  uploaderId: string | null;
  uploadedAt: Date;
  activeMemberIds: readonly string[];
  now?: Date;
}): boolean {
  if (requiredApprovers(input.activeMemberIds, input.userId).length === 0) {
    return true;
  }
  const now = input.now ?? new Date();
  return (
    input.uploaderId === input.userId &&
    now.getTime() - input.uploadedAt.getTime() <= UNDO_WINDOW_MS
  );
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}
