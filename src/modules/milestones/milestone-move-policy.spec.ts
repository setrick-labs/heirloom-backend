import { ForbiddenException } from '@nestjs/common';

import { assertMilestoneMovable, isNoOpMove } from './milestone-move-policy';

const ME = 'user-me';
const SOMEONE_ELSE = 'user-other';

const journey = (id: string, familyId: string, createdBy: string) => ({
  id,
  familyId,
  createdBy,
});

/** Reads out the `code` a ForbiddenException was thrown with. */
function refusalCode(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    const body = (error as ForbiddenException).getResponse() as {
      code?: string;
    };
    return body.code ?? '';
  }
  throw new Error('expected a ForbiddenException');
}

describe('assertMilestoneMovable', () => {
  it('allows a move between two journeys the caller owns in one family', () => {
    expect(() =>
      assertMilestoneMovable(
        journey('journey-a', 'family-1', ME),
        journey('journey-b', 'family-1', ME),
        ME,
      ),
    ).not.toThrow();
  });

  it('refuses moving a place out of a journey the caller does not own', () => {
    expect(
      refusalCode(() =>
        assertMilestoneMovable(
          journey('journey-a', 'family-1', SOMEONE_ELSE),
          journey('journey-b', 'family-1', ME),
          ME,
        ),
      ),
    ).toBe('NOT_SOURCE_JOURNEY_OWNER');
  });

  it('refuses moving a place into a journey the caller does not own', () => {
    expect(
      refusalCode(() =>
        assertMilestoneMovable(
          journey('journey-a', 'family-1', ME),
          journey('journey-b', 'family-1', SOMEONE_ELSE),
          ME,
        ),
      ),
    ).toBe('NOT_DESTINATION_JOURNEY_OWNER');
  });

  it('refuses a cross-family move even when the caller owns both ends', () => {
    expect(
      refusalCode(() =>
        assertMilestoneMovable(
          journey('journey-a', 'family-1', ME),
          journey('journey-b', 'family-2', ME),
          ME,
        ),
      ),
    ).toBe('CROSS_FAMILY_MOVE');
  });

  it('reports the ownership problem before the family one', () => {
    // Both rules are broken at once. Ownership is the more fundamental "this
    // isn't yours to do", so it should be what the caller is told.
    expect(
      refusalCode(() =>
        assertMilestoneMovable(
          journey('journey-a', 'family-1', SOMEONE_ELSE),
          journey('journey-b', 'family-2', ME),
          ME,
        ),
      ),
    ).toBe('NOT_SOURCE_JOURNEY_OWNER');
  });
});

describe('isNoOpMove', () => {
  it('is true only for the journey the milestone is already in', () => {
    expect(isNoOpMove('journey-a', 'journey-a')).toBe(true);
    expect(isNoOpMove('journey-a', 'journey-b')).toBe(false);
  });
});
