import { sessionCutoff } from './session-cutoff.util';

/** What the vault guards check: is this token older than the cutoff? */
const rejected = (iatSeconds: number, cutoff: Date) =>
  iatSeconds * 1000 < cutoff.getTime();

describe('sessionCutoff', () => {
  const now = new Date('2026-09-22T10:00:00.750Z');

  it('drops the milliseconds', () => {
    expect(sessionCutoff(now).toISOString()).toBe('2026-09-22T10:00:00.000Z');
  });

  it('accepts a token issued in the same second as the cutoff', () => {
    const iat = Math.floor(now.getTime() / 1000);
    expect(rejected(iat, sessionCutoff(now))).toBe(false);
    // The bug this exists for: an untruncated cutoff rejects it.
    expect(rejected(iat, now)).toBe(true);
  });

  it('still rejects a token issued in an earlier second', () => {
    const iat = Math.floor(now.getTime() / 1000) - 1;
    expect(rejected(iat, sessionCutoff(now))).toBe(true);
  });
});
