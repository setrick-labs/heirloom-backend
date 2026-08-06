import { randomUUID } from 'node:crypto';

export interface JourneyMediaKeyParams {
  familyId: string;
  journeyId: string;
  milestoneId: string;
  extension: string;
}

export interface VaultItemKeyParams {
  userId: string;
  extension: string;
}

/**
 * Single source of truth for R2 object key layout. Nothing in the codebase
 * should build a key by hand — go through these so the convention can't
 * drift or get typo'd at a call site.
 */
export const StorageKeys = {
  /** {familyId}/{journeyId}/{milestoneId}/{uuid}.{ext} */
  journeyMedia({
    familyId,
    journeyId,
    milestoneId,
    extension,
  }: JourneyMediaKeyParams): string {
    return `${familyId}/${journeyId}/${milestoneId}/${randomUUID()}.${extension}`;
  },

  /** {userId}/vault/{uuid}.{ext} */
  vaultItem({ userId, extension }: VaultItemKeyParams): string {
    return `${userId}/vault/${randomUUID()}.${extension}`;
  },
};
