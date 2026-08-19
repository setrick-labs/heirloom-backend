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

export interface CoverKeyParams {
  scope: 'family' | 'journey' | 'user';
  targetId: string;
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

  /**
   * covers/{scope}/{targetId}/{uuid}.{ext} — family and journey cover
   * photos (Screens 12 and 19), and profile pictures. Namespaced away from
   * journeyMedia so a cover is never picked up by anything that walks a
   * journey's media prefix.
   */
  cover({ scope, targetId, extension }: CoverKeyParams): string {
    return `covers/${scope}/${targetId}/${randomUUID()}.${extension}`;
  },

  /**
   * Deterministic sibling key for a resized variant of an original object
   * — same path/uuid, `-{variant}.webp` appended in place of the original
   * extension. Keeps variants co-located with their original without a
   * separate lookup table.
   */
  mediaVariant(originalKey: string, variant: 'thumb' | 'display'): string {
    const lastDot = originalKey.lastIndexOf('.');
    const withoutExtension =
      lastDot === -1 ? originalKey : originalKey.slice(0, lastDot);
    return `${withoutExtension}-${variant}.webp`;
  },

  /**
   * True for extensions no mainstream mobile client can reliably render
   * un-decoded — currently just HEIC/HEIF. Verified against a live upload:
   * sharp's prebuilt libvips has no HEVC decoder, so these always fail
   * MediaProcessingService (see media.service.ts's toDto, which uses this
   * to decide whether falling back to the original is actually safe, or
   * whether the whole media item has to be treated as unavailable).
   */
  hasUnrenderableExtension(key: string): boolean {
    return /\.(heic|heif)$/i.test(key);
  },
};
