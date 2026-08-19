import type { StorageService } from '../services/storage.service';

/**
 * Resolves the `coverImageUrl` a Family or Journey DTO hands back.
 *
 * Two columns feed one DTO field: `coverStorageKey` (uploaded through the
 * app, must be presigned fresh on every read because those URLs expire) and
 * `coverImageUrl` (a plain URL, if one was ever set directly — seed data,
 * or an external host). The key wins when present.
 *
 * A util rather than a method on MediaService so JourneysService and
 * FamiliesService don't have to import MediaModule for one string; both
 * already have StorageService available, since SharedModule is @Global.
 */
export async function resolveCoverImageUrl(
  storageService: StorageService,
  row: { coverStorageKey: string | null; coverImageUrl: string | null },
): Promise<string | null> {
  return resolveStoredImageUrl(storageService, row.coverStorageKey, row.coverImageUrl);
}

/**
 * The same two-column rule, for any DTO field fed by an uploaded key with a
 * plain-URL fallback. Profile pictures use it via `avatarStorageKey` /
 * `avatarUrl`; covers go through `resolveCoverImageUrl` above.
 */
export async function resolveStoredImageUrl(
  storageService: StorageService,
  storageKey: string | null,
  fallbackUrl: string | null,
): Promise<string | null> {
  if (!storageKey) {
    return fallbackUrl;
  }
  return storageService.generatePresignedDownloadUrl(storageKey);
}
