import { ForbiddenException } from '@nestjs/common';

/** The parts of a journey a move actually turns on. */
export type MoveEndpoint = {
  id: string;
  familyId: string;
  /** The journey's sole owner — see journeys.createdBy. */
  createdBy: string;
};

/**
 * Whether a milestone may move from one journey to another.
 *
 * Moving a stop is otherwise almost free: its memories hang off
 * `media.milestone_id`, so they travel with it without a single media row
 * being rewritten, and `content_views` is keyed by the milestone's own id, so
 * everyone's unread watermark survives too.
 *
 * Two rules gate it.
 *
 * **Both ends must be the caller's own journeys.** A move is not an edit to
 * one journey, it is a withdrawal from one and a deposit into another, and
 * neither half is the mover's to make on someone else's behalf. Note this is
 * deliberately stricter than `requireManage` (which also admits the
 * milestone's creator): creating a stop inside someone else's journey does
 * not make its whereabouts yours to decide, and letting a contributor walk a
 * stop out of a journey they don't own would be a deletion from the owner's
 * point of view.
 *
 * **The two journeys must share a family.** What does not travel with a move
 * is `media.family_id`, which is stored on each media row independently of
 * whichever journey its milestone sits in. Owning journeys in two different
 * families is perfectly ordinary, so ownership alone does not make a move
 * safe: move a stop across families and those rows stay stamped with the
 * family they were uploaded to, leaving the journey's access check
 * (`requireJourneyAccess`) and the media's (`isActiveFamilyMember`, inside
 * `requireMediaAccess`) answering different questions about the same screen —
 * the stop opens for the destination family while every photo inside it 404s,
 * and the source family keeps reaching media through a journey they can no
 * longer see. Rewriting `family_id` across every affected media row is the
 * only way to make that coherent, and that is a transfer of ownership rather
 * than a move, so it is refused here instead of half-done.
 */
export function assertMilestoneMovable(
  source: MoveEndpoint,
  destination: MoveEndpoint,
  userId: string,
): void {
  if (source.createdBy !== userId) {
    throw new ForbiddenException({
      code: 'NOT_SOURCE_JOURNEY_OWNER',
      message: 'Only the owner of a journey can move a place out of it.',
    });
  }

  if (destination.createdBy !== userId) {
    throw new ForbiddenException({
      code: 'NOT_DESTINATION_JOURNEY_OWNER',
      message: 'You can only move a place into a journey you own.',
    });
  }

  if (source.familyId !== destination.familyId) {
    throw new ForbiddenException({
      code: 'CROSS_FAMILY_MOVE',
      message:
        'A place can only move between journeys in the same family. Its memories belong to the family they were added to.',
    });
  }
}

/**
 * A move to the journey it is already in. Treated as success rather than a
 * 400: the only way to send one is a retried request whose first attempt
 * actually landed, and failing that would report an error for work that is
 * already done.
 */
export function isNoOpMove(currentJourneyId: string, targetJourneyId: string) {
  return currentJourneyId === targetJourneyId;
}
