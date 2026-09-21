import {
  UNDO_WINDOW_MS,
  canDeleteItemAlone,
  deletionOutcome,
  isExpired,
  requiredApprovers,
} from './shared-vault-policy';

const members = ['maya', 'sam', 'ali'];

describe('requiredApprovers', () => {
  it('is every active member except the requester', () => {
    expect(requiredApprovers(members, 'maya')).toEqual(['sam', 'ali']);
  });

  it('is nobody when the requester is the only member', () => {
    expect(requiredApprovers(['maya'], 'maya')).toEqual([]);
  });
});

describe('deletionOutcome', () => {
  it('stays pending until everyone else has approved', () => {
    expect(
      deletionOutcome(members, 'maya', [{ userId: 'sam', approve: true }]),
    ).toBe('pending');
  });

  it('is approved once every other member agrees', () => {
    expect(
      deletionOutcome(members, 'maya', [
        { userId: 'sam', approve: true },
        { userId: 'ali', approve: true },
      ]),
    ).toBe('approved');
  });

  it('is declined by a single objection, even after others approved', () => {
    expect(
      deletionOutcome(members, 'maya', [
        { userId: 'sam', approve: true },
        { userId: 'ali', approve: false },
      ]),
    ).toBe('declined');
  });

  it('ignores votes from people who have since left', () => {
    // Ali voted "keep", then left — his objection no longer binds anyone.
    expect(
      deletionOutcome(['maya', 'sam'], 'maya', [
        { userId: 'sam', approve: true },
        { userId: 'ali', approve: false },
      ]),
    ).toBe('approved');
  });

  it('resolves immediately when a member leaving leaves nobody to ask', () => {
    expect(deletionOutcome(['maya'], 'maya', [])).toBe('approved');
  });

  it("doesn't let the requester vote on their own request", () => {
    expect(
      deletionOutcome(members, 'maya', [{ userId: 'maya', approve: true }]),
    ).toBe('pending');
  });
});

describe('canDeleteItemAlone', () => {
  const uploadedAt = new Date('2026-01-01T12:00:00Z');

  it('lets the uploader delete inside the undo window', () => {
    expect(
      canDeleteItemAlone({
        userId: 'maya',
        uploaderId: 'maya',
        uploadedAt,
        activeMemberIds: members,
        now: new Date(uploadedAt.getTime() + UNDO_WINDOW_MS - 1000),
      }),
    ).toBe(true);
  });

  it('requires a vote once the window has passed', () => {
    expect(
      canDeleteItemAlone({
        userId: 'maya',
        uploaderId: 'maya',
        uploadedAt,
        activeMemberIds: members,
        now: new Date(uploadedAt.getTime() + UNDO_WINDOW_MS + 1000),
      }),
    ).toBe(false);
  });

  it("never lets someone delete another person's upload alone", () => {
    expect(
      canDeleteItemAlone({
        userId: 'sam',
        uploaderId: 'maya',
        uploadedAt,
        activeMemberIds: members,
        now: uploadedAt,
      }),
    ).toBe(false);
  });

  it('lets the last remaining member delete anything', () => {
    expect(
      canDeleteItemAlone({
        userId: 'sam',
        uploaderId: 'maya',
        uploadedAt,
        activeMemberIds: ['sam'],
        now: new Date(uploadedAt.getTime() + 10 * UNDO_WINDOW_MS),
      }),
    ).toBe(true);
  });
});

describe('isExpired', () => {
  it('is true at and after the deadline', () => {
    const deadline = new Date('2026-01-08T00:00:00Z');
    expect(isExpired(deadline, new Date('2026-01-07T23:59:59Z'))).toBe(false);
    expect(isExpired(deadline, deadline)).toBe(true);
  });
});
