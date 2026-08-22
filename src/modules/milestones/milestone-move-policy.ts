import { ForbiddenException } from '@nestjs/common';

/** The parts of a journey a move actually turns on. */
export type MoveEndpoint = {
  id: string;
  familyId: string;
};

/**
 * Whether a milestone may move from one journey to another.
 *
 * Moving a stop is otherwise almost free: its memories hang off
 * `media.milestone_id`, so they travel with it without a single media row
 * being rewritten, and `content_views` is keyed by the milestone's own id, so
 * everyone's unread watermark survives too.
 *
 * The one thing that does not travel is `media.family_id`, which is stored on
 * each media row independently of whichever journey its milestone happens to
 * sit in. Move a milestone into another family's journey and those rows stay
 * stamped with the family they were uploaded to — leaving the journey's own
 * access check (`requireJourneyAccess`) and the media's
 * (`isActiveFamilyMember` inside `requireMediaAccess`) answering different
 * questions about the same screen: the stop would open for the destination
 * family while every photo inside it 404s, and the *source* family would keep
 * reaching media through a journey they can no longer see.
 *
 * Rewriting `family_id` across every affected media row is the only way to
 * make a cross-family move coherent, and that is a transfer of ownership
 * rather than a move — so it is refused here instead of half-done.
 */
export function assertMilestoneMovable(
  source: MoveEndpoint,
  destination: MoveEndpoint,
): void {
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
