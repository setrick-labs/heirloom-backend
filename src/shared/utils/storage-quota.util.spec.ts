import { BadRequestException } from '@nestjs/common';

import type { Database } from '../../database/connection';
import {
  USER_STORAGE_QUOTA_BYTES,
  assertStorageQuota,
  getUserStorageUsage,
} from './storage-quota.util';

const GB = 1024 * 1024 * 1024;

/**
 * The two sums are issued in parallel and resolved in order (media first,
 * vault second), so the stub answers from a queue rather than trying to
 * recognise which table it was handed.
 */
function stubDb(sums: [mediaBytes: unknown, vaultBytes: unknown]): Database {
  const answers = [...sums];
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ bytes: answers.shift() }]),
      }),
    }),
  } as unknown as Database;
}

describe('getUserStorageUsage', () => {
  it('adds the media and vault totals together', async () => {
    const usage = await getUserStorageUsage(stubDb(['2000', '500']), 'user-1');

    expect(usage.usedBytes).toBe(2500);
    expect(usage.limitBytes).toBe(USER_STORAGE_QUOTA_BYTES);
    expect(usage.remainingBytes).toBe(USER_STORAGE_QUOTA_BYTES - 2500);
  });

  it('numbers the driver’s bigint strings rather than concatenating them', async () => {
    // The regression this guards: '2000' + '500' is '2000500', a usage figure
    // three orders of magnitude too large, which would lock a user out of
    // uploading with no visible cause.
    const usage = await getUserStorageUsage(stubDb(['2000', '500']), 'user-1');

    expect(typeof usage.usedBytes).toBe('number');
    expect(usage.usedBytes).not.toBe(2000500);
  });

  it('treats a user with nothing stored as zero, not NaN', async () => {
    const usage = await getUserStorageUsage(
      stubDb([null, undefined]),
      'user-1',
    );

    expect(usage.usedBytes).toBe(0);
    expect(usage.remainingBytes).toBe(USER_STORAGE_QUOTA_BYTES);
  });

  it('never reports negative headroom for a user already over the line', async () => {
    const over = String(USER_STORAGE_QUOTA_BYTES + 5 * GB);
    const usage = await getUserStorageUsage(stubDb([over, '0']), 'user-1');

    expect(usage.remainingBytes).toBe(0);
  });
});

describe('assertStorageQuota', () => {
  it('allows an upload that fits', async () => {
    await expect(
      assertStorageQuota(stubDb(['0', '0']), 'user-1', 10 * GB),
    ).resolves.toBeUndefined();
  });

  it('allows an upload that lands exactly on the limit', async () => {
    const used = String(USER_STORAGE_QUOTA_BYTES - 100);

    await expect(
      assertStorageQuota(stubDb([used, '0']), 'user-1', 100),
    ).resolves.toBeUndefined();
  });

  it('rejects the byte that would cross it', async () => {
    const used = String(USER_STORAGE_QUOTA_BYTES - 100);

    await expect(
      assertStorageQuota(stubDb([used, '0']), 'user-1', 101),
    ).rejects.toThrow(BadRequestException);
  });

  it('counts the vault against the same allowance as shared media', async () => {
    const half = String(USER_STORAGE_QUOTA_BYTES / 2);

    // Neither half alone would exceed the cap; together they leave no room.
    await expect(
      assertStorageQuota(stubDb([half, half]), 'user-1', 1),
    ).rejects.toThrow(BadRequestException);
  });

  it('reports STORAGE_QUOTA_EXCEEDED with the numbers behind it', async () => {
    const used = String(USER_STORAGE_QUOTA_BYTES);

    try {
      await assertStorageQuota(stubDb([used, '0']), 'user-1', 1024);
      fail('expected a rejection');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'STORAGE_QUOTA_EXCEEDED',
        details: {
          usedBytes: USER_STORAGE_QUOTA_BYTES,
          limitBytes: USER_STORAGE_QUOTA_BYTES,
          remainingBytes: 0,
          requestedBytes: 1024,
        },
      });
    }
  });
});
