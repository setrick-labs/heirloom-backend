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
  if (!row.coverStorageKey) {
    return row.coverImageUrl;
  }
  return storageService.generatePresignedDownloadUrl(row.coverStorageKey);
}
