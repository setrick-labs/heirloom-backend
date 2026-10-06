import type { VaultItemRow } from '../../database/schema/vault-items';
import type { StorageService } from '../../shared/services/storage.service';
import { resolveVariantUrls } from '../../shared/utils/media-variants.util';
import type { VaultItem } from './validations/vault.schema';

/**
 * The one shape a Vault item leaves the API in — from VaultService, and from
 * MediaService.moveToVault, which writes vault rows without going through
 * VaultService (see vault.module.ts for why).
 *
 * Always presigned and short-lived, like everything in the Vault: no
 * unsigned path to private content, for the original or any variant.
 */
export async function toVaultItemDto(
  storage: StorageService,
  row: VaultItemRow,
): Promise<VaultItem> {
  const urls = await resolveVariantUrls(storage, row);
  return {
    id: row.id,
    type: row.type,
    ...urls,
    blurhash: row.blurhash,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    caption: row.caption,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}
