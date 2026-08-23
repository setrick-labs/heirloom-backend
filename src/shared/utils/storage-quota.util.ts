import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { env } from '../../config/env';
import type { Database } from '../../database/connection';
import { media, vaultItems } from '../../database/schema';

const GIGABYTE = 1024 * 1024 * 1024;

/** The per-person allowance, in bytes (env.USER_STORAGE_QUOTA_BYTES, 30 GiB by default). */
export const USER_STORAGE_QUOTA_BYTES = env.USER_STORAGE_QUOTA_BYTES;

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  /** Never negative — a user already over the line reads as 0 left, not a debt. */
  remainingBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(1)}GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))}MB`;
}

/**
 * Everything one person is charged for: the family-shared media rows they
 * own, plus their private Vault items.
 *
 * Summed live rather than kept as a running counter on `users`. Both tables
 * are hard-deleted (MediaService.delete, VaultService.deleteItem both remove
 * the row and the object), so a SUM is always the truth, while a counter
 * would drift the first time a delete path missed a decrement — and a
 * silently wrong quota is worse than a slightly slower one. Both sums are
 * indexed-column scans on a per-user slice, and they only run on the upload
 * path (once per file) and the storage screen.
 *
 * Rows with a null `size_bytes` (older uploads registered before the client
 * sent a size) count as zero. That undercounts rather than overcounts, which
 * is the right way to be wrong about someone else's allowance.
 */
export async function getUserStorageUsage(
  db: Database,
  userId: string,
): Promise<StorageUsage> {
  const [mediaTotal, vaultTotal] = await Promise.all([
    db
      .select({
        bytes: sql<string>`coalesce(sum(${media.sizeBytes}), 0)`,
      })
      .from(media)
      .where(eq(media.ownerId, userId)),
    db
      .select({
        bytes: sql<string>`coalesce(sum(${vaultItems.sizeBytes}), 0)`,
      })
      .from(vaultItems)
      .where(eq(vaultItems.ownerId, userId)),
  ]);

  // postgres returns sum() over bigint as a numeric *string* — Number() it
  // here rather than trusting the driver, or the addition below silently
  // becomes string concatenation.
  const usedBytes =
    Number(mediaTotal[0]?.bytes ?? 0) + Number(vaultTotal[0]?.bytes ?? 0);

  return {
    usedBytes,
    limitBytes: USER_STORAGE_QUOTA_BYTES,
    remainingBytes: Math.max(0, USER_STORAGE_QUOTA_BYTES - usedBytes),
  };
}

/**
 * Rejects an upload that would push the owner past their allowance.
 *
 * Called when a presigned PUT is *requested*, which is the only moment we
 * can refuse one: the upload itself goes straight from the device to R2 and
 * never passes through this process, exactly as with the per-file size caps
 * in media-upload-policy.ts.
 *
 * The consequence is that this is a check against the declared size, not the
 * delivered one, and two uploads requested in the same instant can both pass
 * against the same usage figure. Both are bounded overshoots — a single file
 * is capped at 300MB by the size policy — and the alternative (reserving
 * bytes at request time, reconciling on registration or expiry) buys
 * accuracy nobody can perceive at the cost of a whole reservation lifecycle.
 */
export async function assertStorageQuota(
  db: Database,
  userId: string,
  additionalBytes: number,
): Promise<void> {
  const usage = await getUserStorageUsage(db, userId);

  if (usage.usedBytes + additionalBytes > usage.limitBytes) {
    throw new BadRequestException({
      code: 'STORAGE_QUOTA_EXCEEDED',
      message: `You've used ${formatBytes(usage.usedBytes)} of your ${formatBytes(usage.limitBytes)}. Free up some space to upload this ${formatBytes(additionalBytes)} file.`,
      details: {
        usedBytes: usage.usedBytes,
        limitBytes: usage.limitBytes,
        remainingBytes: usage.remainingBytes,
        requestedBytes: additionalBytes,
      },
    });
  }
}
