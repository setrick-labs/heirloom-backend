import { ForbiddenException } from '@nestjs/common';

import {
  assertMilestoneMovable,
  isNoOpMove,
} from './milestone-move-policy';

const journey = (id: string, familyId: string) => ({ id, familyId });

describe('assertMilestoneMovable', () => {
  it('allows a move between journeys in the same family', () => {
    expect(() =>
      assertMilestoneMovable(
        journey('journey-a', 'family-1'),
        journey('journey-b', 'family-1'),
      ),
    ).not.toThrow();
  });

  it('refuses a move into another family', () => {
    expect(() =>
      assertMilestoneMovable(
        journey('journey-a', 'family-1'),
        journey('journey-b', 'family-2'),
      ),
    ).toThrow(ForbiddenException);
  });

  it('names the reason, so the client can show it rather than a generic 403', () => {
    try {
      assertMilestoneMovable(
        journey('journey-a', 'family-1'),
        journey('journey-b', 'family-2'),
      );
      throw new Error('expected a ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'CROSS_FAMILY_MOVE',
      });
    }
  });
});

describe('isNoOpMove', () => {
  it('is true only for the journey the milestone is already in', () => {
    expect(isNoOpMove('journey-a', 'journey-a')).toBe(true);
    expect(isNoOpMove('journey-a', 'journey-b')).toBe(false);
  });
});
