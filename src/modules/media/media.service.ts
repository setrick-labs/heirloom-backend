import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import {
  comments,
  journeys,
  media,
  milestones,
  reactions,
  users,
  vaultItems,
} from '../../database/schema';
import { NotificationService } from '../../shared/services/notification.service';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import { requireMediaOwner } from '../../shared/utils/media-access.util';
import { assertStorageQuota } from '../../shared/utils/storage-quota.util';
import type { VaultItem } from '../vault/validations/vault.schema';
import { MediaProcessingService } from './media-processing.service';
import { assertValidMediaUpload } from './media-upload-policy';
import {
  CreateMediaInput,
  Media,
  RequestCommentAttachmentUploadUrlInput,
  RequestCoverUploadUrlInput,
  RequestUploadUrlInput,
} from './validations/media.schema';

export interface RequestUploadUrlResult {
  key: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * How far back to look when counting "this upload" as one event.
 *
 * Long enough to cover a slow multi-file upload on a bad connection, short
 * enough that two genuinely separate visits to the same stop read as two
 * events rather than one running total.
 */
const BATCH_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
    private readonly mediaProcessingService: MediaProcessingService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Step 1 of upload: validate the declared content type/size, mint a
   * {familyId}/{journeyId}/{milestoneId}/{uuid}.{ext} key, and hand back a
   * presigned PUT URL. The client uploads bytes straight to R2 — they never
   * pass through this server. `milestoneId` may be a client-generated id for
   * a Milestone that doesn't exist yet (Milestones spec Section 1) — this is
   * just a storage-key namespace, not a row lookup.
   */
  async requestUploadUrl(
    userId: string,
    input: RequestUploadUrlInput,
  ): Promise<RequestUploadUrlResult> {
    if (!(await isActiveFamilyMember(this.db, userId, input.familyId))) {
      throw new NotFoundException('Family not found');
    }
    await requireJourneyAccess(this.db, userId, input.journeyId);

    const extension = assertValidMediaUpload(
      input.contentType,
      input.sizeBytes,
    );
    await assertStorageQuota(this.db, userId, input.sizeBytes);
    const key = StorageKeys.journeyMedia({
      familyId: input.familyId,
      journeyId: input.journeyId,
      milestoneId: input.milestoneId,
      extension,
    });
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      key,
      input.contentType,
      UPLOAD_URL_TTL_SECONDS,
    );

    return { key, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Presigned PUT for a Family or Journey cover photo (Screens 12, 19).
   *
   * Authorization is deliberately coarse here — any signed-in user can mint
   * a cover key — because both screens upload the photo *before* the row it
   * belongs to exists, so there is nothing yet to check membership against.
   * The real gate is on the other side: the key only ever becomes visible
   * once an update call that IS access-checked (families.update /
   * journeys.update, both owner/admin-gated) accepts it as coverStorageKey.
   * Minting an unreferenced key achieves nothing but an orphaned object.
   */
  async requestCoverUploadUrl(
    input: RequestCoverUploadUrlInput,
  ): Promise<RequestUploadUrlResult> {
    const extension = assertValidMediaUpload(
      input.contentType,
      input.sizeBytes,
    );
    const key = StorageKeys.cover({
      scope: input.scope,
      targetId: input.targetId,
      extension,
    });
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      key,
      input.contentType,
      UPLOAD_URL_TTL_SECONDS,
    );

    return { key, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Presigned PUT for a photo attached directly to a comment — no Journey
   * or Milestone to check access through, so plain family membership is
   * the whole gate (same posture as everyday family-scoped reads).
   */
  async requestCommentAttachmentUploadUrl(
    userId: string,
    input: RequestCommentAttachmentUploadUrlInput,
  ): Promise<RequestUploadUrlResult> {
    if (!(await isActiveFamilyMember(this.db, userId, input.familyId))) {
      throw new NotFoundException('Family not found');
    }

    const extension = assertValidMediaUpload(
      input.contentType,
      input.sizeBytes,
    );
    await assertStorageQuota(this.db, userId, input.sizeBytes);
    const key = StorageKeys.commentAttachment({
      familyId: input.familyId,
      extension,
    });
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      key,
      input.contentType,
      UPLOAD_URL_TTL_SECONDS,
    );

    return { key, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Section 6: adding media to an EXISTING Milestone — anyone with
   * visibility into the Milestone's journey, not just its creator. (The
   * *first* media on a new Milestone is inserted directly by
   * MilestonesService.create in the same transaction as the Milestone row,
   * not through here — this path only ever targets a Milestone that already
   * exists.)
   */
  async create(ownerId: string, input: CreateMediaInput): Promise<Media> {
    if (input.milestoneId) {
      const milestone = await this.db.query.milestones.findFirst({
        where: eq(milestones.id, input.milestoneId),
      });
      if (!milestone) {
        throw new NotFoundException('Milestone not found');
      }
      await requireJourneyAccess(this.db, ownerId, milestone.journeyId);
    } else {
      // A comment attachment — no Milestone to check access through,
      // family membership is the gate (same as requestCommentAttachmentUploadUrl,
      // which minted this row's storage key in the first place).
      if (!(await isActiveFamilyMember(this.db, ownerId, input.familyId))) {
        throw new NotFoundException('Family not found');
      }
    }

    const [created] = await this.db
      .insert(media)
      .values({
        familyId: input.familyId,
        milestoneId: input.milestoneId,
        type: input.type,
        storageKey: input.key,
        caption: input.caption,
        sizeBytes: input.sizeBytes,
        // The column is whole seconds; a 0.4s tap still counts as a second
        // rather than reading back as "no duration".
        durationSeconds:
          input.type === 'audio' && input.durationSeconds
            ? Math.max(1, Math.round(input.durationSeconds))
            : undefined,
        waveform:
          input.type === 'audio' && input.waveform?.length
            ? input.waveform
            : undefined,
        ownerId,
        // Set before the fire-and-forget pass even starts — see enums.ts.
        processingStatus: input.type === 'image' ? 'pending' : undefined,
      })
      .returning();

    // Fire-and-forget: this response must not wait on a multi-second
    // fetch+resize+upload round trip. The client gets the original as its
    // url/thumbnailUrl for now (toDto()'s built-in fallback); the next time
    // it fetches this media id, the variants will be in place. See
    // MediaProcessingService.processAndPersist for why this is safe to not await.
    void this.mediaProcessingService.processAndPersist(
      created.id,
      created.storageKey,
      input.type,
    );

    // Also fire-and-forget, and for a stronger reason than speed: the upload
    // has already succeeded, so nothing about announcing it may be allowed to
    // fail it. A comment attachment (no milestone) is not a memory and
    // announces nothing.
    if (input.milestoneId) {
      void this.announceNewMemory(ownerId, input.milestoneId);
    }

    return this.toDto(created);
  }

  /**
   * "Maya added 3 memories" to everyone else who can see the Journey.
   *
   * The count is re-read rather than tracked, because the client registers
   * one media row per file: a ten-photo upload arrives here ten times, and
   * counting the uploader's recent rows is what turns that back into the one
   * event a person actually experienced. Paired with the collapse id in
   * NotificationService, each new file replaces the previous notification
   * instead of adding to a pile.
   */
  private async announceNewMemory(
    ownerId: string,
    milestoneId: string,
  ): Promise<void> {
    try {
      const milestone = await this.db.query.milestones.findFirst({
        where: eq(milestones.id, milestoneId),
      });
      if (!milestone) return;

      const [journey, actor] = await Promise.all([
        this.db.query.journeys.findFirst({
          where: eq(journeys.id, milestone.journeyId),
        }),
        this.db.query.users.findFirst({ where: eq(users.id, ownerId) }),
      ]);
      if (!journey || !actor) return;

      const [recent] = await this.db
        .select({ value: count() })
        .from(media)
        .where(
          and(
            eq(media.ownerId, ownerId),
            eq(media.milestoneId, milestoneId),
            gte(media.createdAt, new Date(Date.now() - BATCH_WINDOW_MS)),
          ),
        );

      await this.notificationService.pushNewMemory({
        actorId: ownerId,
        actorName: actor.name,
        journeyId: journey.id,
        journeyTitle: journey.title,
        milestoneId,
        count: recent?.value ?? 1,
      });
    } catch (error) {
      this.logger.error(`Failed to announce new memory: ${error}`);
    }
  }

  /**
   * Resolves a comment's attachment for embedding directly on the comment
   * DTO — deliberately not `findById`/`requireMediaAccess`, both of which
   * require a Milestone and would 404 a comment-attachment row every time.
   * No access check here at all: the comment itself already gated who can
   * see this (CommentsService calls this only after requireTargetAccess
   * has passed), so re-checking milestone/journey access against a row
   * that has neither would be wrong, not just redundant.
   */
  async resolveForComment(mediaId: string): Promise<Media | null> {
    const row = await this.db.query.media.findFirst({
      where: eq(media.id, mediaId),
    });
    if (!row) return null;
    return this.toDto(row);
  }

  async listByFamily(userId: string, familyId: string): Promise<Media[]> {
    if (!(await isActiveFamilyMember(this.db, userId, familyId))) {
      throw new NotFoundException('Family not found');
    }
    const rows = await this.db.query.media.findMany({
      where: eq(media.familyId, familyId),
    });
    return this.toDtoList(rows);
  }

  /**
   * Screen 24's grid — one Milestone's Memories, newest first. Access runs
   * through the milestone's parent journey, so a media row is never
   * reachable here that requireJourneyAccess would refuse individually.
   */
  async listByMilestone(userId: string, milestoneId: string): Promise<Media[]> {
    const milestone = await this.db.query.milestones.findFirst({
      where: and(eq(milestones.id, milestoneId), isNull(milestones.deletedAt)),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await requireJourneyAccess(this.db, userId, milestone.journeyId);

    const rows = await this.db.query.media.findMany({
      where: eq(media.milestoneId, milestoneId),
      orderBy: desc(media.createdAt),
    });
    return this.toDtoList(rows);
  }

  private async toDtoList(
    rows: (typeof media.$inferSelect)[],
  ): Promise<Media[]> {
    const ids = rows.map((r) => r.id);
    const [commentCounts, reactionCounts] = await Promise.all([
      this.countCommentsFor(ids),
      this.countReactionsFor(ids),
    ]);
    // toDto() throws for an image that's confirmed unrenderable (see
    // there) — one such item shouldn't 500 an entire list, so those are
    // dropped here rather than propagated.
    const dtos = await Promise.all(
      rows.map(async (row) => {
        try {
          return await this.toDto(
            row,
            commentCounts.get(row.id) ?? 0,
            reactionCounts.get(row.id) ?? 0,
          );
        } catch (error) {
          this.logger.warn(
            `Skipping unrenderable media ${row.id} in list: ${error}`,
          );
          return null;
        }
      }),
    );
    return dtos.filter((dto): dto is Media => dto !== null);
  }

  async findById(userId: string, id: string): Promise<Media> {
    const row = await this.db.query.media.findFirst({
      where: eq(media.id, id),
    });
    if (!row?.milestoneId) {
      throw new NotFoundException('Media not found');
    }
    const milestone = await this.db.query.milestones.findFirst({
      where: eq(milestones.id, row.milestoneId),
    });
    if (!milestone) {
      throw new NotFoundException('Media not found');
    }
    await requireJourneyAccess(this.db, userId, milestone.journeyId);
    const [commentCounts, reactionCounts] = await Promise.all([
      this.countCommentsFor([row.id]),
      this.countReactionsFor([row.id]),
    ]);
    return this.toDto(
      row,
      commentCounts.get(row.id) ?? 0,
      reactionCounts.get(row.id) ?? 0,
    );
  }

  /**
   * Section 8: restricted to whoever uploaded it — not the Milestone
   * creator, not the journey owner (deliberate governance tension, flagged
   * in the spec rather than resolved either way). Also clears any
   * comments/reactions that pointed at this specific media item, since
   * their target association is polymorphic (no DB-level FK to cascade).
   */
  async delete(userId: string, id: string): Promise<void> {
    const row = await requireMediaOwner(this.db, userId, id);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(comments)
        .where(
          and(eq(comments.targetType, 'media'), eq(comments.targetId, id)),
        );
      await tx
        .delete(reactions)
        .where(
          and(eq(reactions.targetType, 'media'), eq(reactions.targetId, id)),
        );
      await tx.delete(media).where(eq(media.id, id));
    });

    try {
      // Every copy, not just the original — the variants used to be left
      // behind in the bucket after the row was gone.
      await this.deleteStoredCopies(row);
    } catch (error) {
      // Never let storage cleanup block the DB operation the user is
      // waiting on — an orphaned R2 object is cheap; a stuck delete isn't.
      this.logger.warn(
        `Failed to delete storage object ${row.storageKey}: ${error}`,
      );
    }
  }

  /**
   * Milestone → Vault: the mirror image of VaultService.moveToMilestone.
   * Same uploader-only gate as `delete()` — moving something out from under
   * a discussion someone else built is exactly as restricted as removing it
   * outright, and the same reasoning applies (Milestones spec Section 8).
   *
   * The object is copied into the Vault's own key namespace rather than
   * repointed in place: the two live under different prefixes
   * (StorageKeys.journeyMedia vs .vaultItem) by design (see vault-items.ts
   * — the Vault never shares a storage convention with shared content), so
   * "moving" here means create-then-delete, not a rename.
   *
   * Only the original object comes along — thumbnail/display variants are
   * dropped along with the `media` row they belonged to, since the Vault
   * has no variant concept of its own (`vault/viewer.tsx` reads the
   * original directly). A fresh set would only ever regenerate if the item
   * moved back into a Milestone later, at which point moveToMilestone's own
   * fire-and-forget processing pass produces new ones anyway.
   */
  async moveToVault(userId: string, mediaId: string): Promise<VaultItem> {
    const row = await requireMediaOwner(this.db, userId, mediaId);

    const destinationKey = StorageKeys.vaultItem({
      userId,
      extension: StorageKeys.extensionOf(row.storageKey),
    });
    await this.storageService.copyObject(row.storageKey, destinationKey);

    const [item] = await this.db.transaction(async (tx) => {
      // Same polymorphic cleanup `delete()` does — the Vault has no
      // comment/reaction concept, so these can't travel with the row.
      await tx
        .delete(comments)
        .where(
          and(eq(comments.targetType, 'media'), eq(comments.targetId, mediaId)),
        );
      await tx
        .delete(reactions)
        .where(
          and(
            eq(reactions.targetType, 'media'),
            eq(reactions.targetId, mediaId),
          ),
        );
      await tx.delete(media).where(eq(media.id, mediaId));
      return tx
        .insert(vaultItems)
        .values({
          ownerId: userId,
          type: row.type,
          storageKey: destinationKey,
          caption: row.caption,
          sizeBytes: row.sizeBytes,
        })
        .returning();
    });

    try {
      await this.deleteStoredCopies(row);
    } catch (error) {
      this.logger.warn(
        `Failed to delete storage object(s) for moved media ${mediaId}: ${error}`,
      );
    }

    return {
      id: item.id,
      type: item.type,
      url: await this.resolveUrl(item.storageKey),
      caption: item.caption,
      sizeBytes: item.sizeBytes,
      createdAt: item.createdAt.toISOString(),
    };
  }

  /** The original and whichever processed variants exist for it. */
  private async deleteStoredCopies(
    row: Pick<
      typeof media.$inferSelect,
      'storageKey' | 'thumbnailStorageKey' | 'displayStorageKey' | 'zoomStorageKey'
    >,
  ): Promise<void> {
    const keys = [
      row.storageKey,
      row.thumbnailStorageKey,
      row.displayStorageKey,
      row.zoomStorageKey,
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) await this.storageService.deleteObject(key);
  }

  private async resolveUrl(storageKey: string): Promise<string> {
    return this.storageService.generatePresignedDownloadUrl(storageKey);
  }

  /**
   * `commentCount`/`reactionCount` back the small `💬 4` / `❤️ 4` pills a
   * grid tile puts on any memory with an active discussion or likes — the
   * only signal a tile has either before you open it, so both have to come
   * back with the tile itself rather than from a second per-tile request.
   * Callers that have a batch of rows should pass precomputed maps (see
   * countCommentsFor/countReactionsFor); both default to 0 so single-row
   * callers that genuinely don't need them (a freshly created row, a
   * comment's own attachment) stay simple.
   */
  private async toDto(
    row: typeof media.$inferSelect,
    commentCount = 0,
    reactionCount = 0,
  ): Promise<Media> {
    // Falling back to the original is fine for most failure causes (a
    // transient fetch error, an oversized-but-valid PNG, processing that
    // just hasn't run yet) — any normal client can still render the
    // original in those cases. It is NOT fine when the original itself is
    // in a format no processing pass will ever fix and that Android can't
    // reliably render un-decoded (verified against a live HEIC upload —
    // see MediaProcessingService). Once processing has actually run and
    // confirmed that, refuse to hand back the broken original instead of
    // silently serving an image that won't display.
    if (
      row.type === 'image' &&
      row.processingStatus === 'failed' &&
      !row.displayStorageKey &&
      StorageKeys.hasUnrenderableExtension(row.storageKey)
    ) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_PROCESSING_FAILED',
        message:
          "This photo couldn't be processed and can't be displayed — its format isn't supported.",
      });
    }

    // Falls back to the original whenever a variant key is unset — non-image
    // media, or an image whose processing pass failed/hasn't run yet.
    const [url, thumbnailUrl, zoomUrl] = await Promise.all([
      this.resolveUrl(row.displayStorageKey ?? row.storageKey),
      this.resolveUrl(row.thumbnailStorageKey ?? row.storageKey),
      // No fallback to the original here, unlike the two above: it can be any
      // size, and decoding it on zoom is exactly the memory spike this avoids.
      row.zoomStorageKey ? this.resolveUrl(row.zoomStorageKey) : null,
    ]);
    return {
      id: row.id,
      familyId: row.familyId,
      ownerId: row.ownerId,
      type: row.type,
      url,
      thumbnailUrl,
      zoomUrl,
      blurhash: row.blurhash,
      caption: row.caption,
      width: row.width,
      height: row.height,
      durationSeconds: row.durationSeconds,
      waveform: row.waveform,
      sizeBytes: row.sizeBytes,
      commentCount,
      reactionCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** One grouped query for a whole grid's worth of tiles, keyed by media id. */
  private async countCommentsFor(
    mediaIds: string[],
  ): Promise<Map<string, number>> {
    if (mediaIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ targetId: comments.targetId, value: count() })
      .from(comments)
      .where(
        and(
          eq(comments.targetType, 'media'),
          inArray(comments.targetId, mediaIds),
        ),
      )
      .groupBy(comments.targetId);
    return new Map(rows.map((row) => [row.targetId, row.value]));
  }

  /**
   * One grouped query for a whole grid's worth of tiles, keyed by media id —
   * same shape as countCommentsFor. Counts every reaction row regardless of
   * emoji: today the app only ever puts a heart on media, but this is the
   * "how many people reacted" count a tile shows, not a per-emoji breakdown.
   */
  private async countReactionsFor(
    mediaIds: string[],
  ): Promise<Map<string, number>> {
    if (mediaIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ targetId: reactions.targetId, value: count() })
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, 'media'),
          inArray(reactions.targetId, mediaIds),
        ),
      )
      .groupBy(reactions.targetId);
    return new Map(rows.map((row) => [row.targetId, row.value]));
  }
}
