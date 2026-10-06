import { StorageKeys } from '../services/storage-keys.util';
import type { StorageService } from '../services/storage.service';

/**
 * The stored-file side of anything MediaProcessingService has processed —
 * `media`, `vault_items` and `shared_vault_items` all carry these columns
 * (database/schema/_helpers.ts `processedVariants`, and the same names on
 * media.ts).
 */
export interface StoredVariants {
  type: 'image' | 'video' | 'audio';
  storageKey: string;
  thumbnailStorageKey: string | null;
  displayStorageKey: string | null;
  zoomStorageKey: string | null;
  posterStorageKey: string | null;
}

export interface VariantUrls {
  /** Display variant (a streaming MP4, for video), else the original. */
  url: string;
  /** A still: never a movie — see StorageKeys.previewImageKey. */
  thumbnailUrl: string | null;
  zoomUrl: string | null;
  posterUrl: string | null;
}

/**
 * Presigned URLs for every variant a row has. Falls back to the original for
 * `url` whenever the display variant is missing (audio, or processing that
 * failed or hasn't finished), and for `thumbnailUrl` only when the original
 * is itself an image.
 */
export async function resolveVariantUrls(
  storage: StorageService,
  row: StoredVariants,
): Promise<VariantUrls> {
  const sign = (key: string) => storage.generatePresignedDownloadUrl(key);
  const thumbKey = StorageKeys.previewImageKey(row);
  const [url, thumbnailUrl, zoomUrl, posterUrl] = await Promise.all([
    sign(row.displayStorageKey ?? row.storageKey),
    thumbKey ? sign(thumbKey) : null,
    // No fallback to the original here: it can be any size, and decoding it
    // on zoom is exactly the memory spike the zoom variant avoids.
    row.zoomStorageKey ? sign(row.zoomStorageKey) : null,
    row.posterStorageKey ? sign(row.posterStorageKey) : null,
  ]);
  return { url, thumbnailUrl, zoomUrl, posterUrl };
}

/** Every object a row owns in the bucket — the original and each variant — for deleting it completely. */
export function storedKeysOf(row: Omit<StoredVariants, 'type'>): string[] {
  return [
    row.storageKey,
    row.thumbnailStorageKey,
    row.displayStorageKey,
    row.zoomStorageKey,
    row.posterStorageKey,
  ].filter((key): key is string => Boolean(key));
}

/** Best-effort removal of everything storedKeysOf lists. An orphaned object is cheap; a stuck delete isn't. */
export async function deleteStoredKeys(
  storage: StorageService,
  row: Omit<StoredVariants, 'type'>,
): Promise<void> {
  await Promise.all(
    storedKeysOf(row).map((key) =>
      storage.deleteObject(key).catch(() => undefined),
    ),
  );
}

type VariantColumn =
  | 'thumbnailStorageKey'
  | 'displayStorageKey'
  | 'zoomStorageKey'
  | 'posterStorageKey';

const VARIANTS: [VariantColumn, 'thumb' | 'display' | 'zoom' | 'poster'][] = [
  ['thumbnailStorageKey', 'thumb'],
  ['displayStorageKey', 'display'],
  ['zoomStorageKey', 'zoom'],
  ['posterStorageKey', 'poster'],
];

/**
 * When an original is copied to a new key (a memory moved into the Vault),
 * its processed variants come along as copies beside it — a server-side copy
 * in the bucket, not a second ffmpeg pass over a video that has already had
 * one. Returns the new keys, to write onto the new row with whatever else
 * processing produced (blurhash, size, duration), which carries over as is.
 *
 * Throws if a copy fails; the caller then just processes the new original
 * from scratch instead.
 */
export async function copyVariants(
  storage: StorageService,
  source: Omit<StoredVariants, 'type'>,
  destinationKey: string,
): Promise<Record<VariantColumn, string | null>> {
  const copied = await Promise.all(
    VARIANTS.map(async ([column, variant]) => {
      const sourceKey = source[column];
      if (!sourceKey) return [column, null] as const;
      const extension = sourceKey.endsWith('.mp4') ? 'mp4' : 'webp';
      const key = StorageKeys.mediaVariant(destinationKey, variant, extension);
      await storage.copyObject(sourceKey, key);
      return [column, key] as const;
    }),
  );
  return Object.fromEntries(copied) as Record<VariantColumn, string | null>;
}
