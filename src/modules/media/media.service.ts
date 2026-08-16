import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { comments, media, milestones, reactions } from '../../database/schema';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import { requireJourneyAccess } from '../../shared/utils/journey-access.util';
import { requireMediaOwner } from '../../shared/utils/media-access.util';
import { MediaProcessingService } from './media-processing.service';
import { assertValidMediaUpload } from './media-upload-policy';
import {
  CreateMediaInput,
  Media,
  RequestCoverUploadUrlInput,
  RequestUploadUrlInput,
} from './validations/media.schema';

export interface RequestUploadUrlResult {
  key: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

const UPLOAD_URL_TTL_SECONDS = 300;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
    private readonly mediaProcessingService: MediaProcessingService,
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
   * Section 6: adding media to an EXISTING Milestone — anyone with
   * visibility into the Milestone's journey, not just its creator. (The
   * *first* media on a new Milestone is inserted directly by
   * MilestonesService.create in the same transaction as the Milestone row,
   * not through here — this path only ever targets a Milestone that already
   * exists.)
   */
  async create(ownerId: string, input: CreateMediaInput): Promise<Media> {
    const milestone = await this.db.query.milestones.findFirst({
      where: eq(milestones.id, input.milestoneId),
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    await requireJourneyAccess(this.db, ownerId, milestone.journeyId);

    const [created] = await this.db
      .insert(media)
      .values({
        familyId: input.familyId,
        milestoneId: input.milestoneId,
        type: input.type,
        storageKey: input.key,
        caption: input.caption,
        sizeBytes: input.sizeBytes,
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
    return this.toDto(created);
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
    const commentCounts = await this.countCommentsFor(rows.map((r) => r.id));
    // toDto() throws for an image that's confirmed unrenderable (see
    // there) — one such item shouldn't 500 an entire list, so those are
    // dropped here rather than propagated.
    const dtos = await Promise.all(
      rows.map(async (row) => {
        try {
          return await this.toDto(row, commentCounts.get(row.id) ?? 0);
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
    const counts = await this.countCommentsFor([row.id]);
    return this.toDto(row, counts.get(row.id) ?? 0);
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
      await this.storageService.deleteObject(row.storageKey);
    } catch (error) {
      // Never let storage cleanup block the DB operation the user is
      // waiting on — an orphaned R2 object is cheap; a stuck delete isn't.
      this.logger.warn(
        `Failed to delete storage object ${row.storageKey}: ${error}`,
      );
    }
  }

  private async resolveUrl(storageKey: string): Promise<string> {
    return this.storageService.generatePresignedDownloadUrl(storageKey);
  }

  /**
   * `commentCount` backs the small `💬 4` pill Screen 24 puts on any grid
   * tile with an active discussion — it's the only signal a tile has one
   * before you open it, so it has to come back with the tile itself rather
   * than from a second per-tile request. Callers that have a batch of rows
   * should pass a precomputed map (see countCommentsFor); it defaults to 0
   * so single-row callers that genuinely don't need it stay simple.
   */
  private async toDto(
    row: typeof media.$inferSelect,
    commentCount = 0,
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
    const [url, thumbnailUrl] = await Promise.all([
      this.resolveUrl(row.displayStorageKey ?? row.storageKey),
      this.resolveUrl(row.thumbnailStorageKey ?? row.storageKey),
    ]);
    return {
      id: row.id,
      familyId: row.familyId,
      ownerId: row.ownerId,
      type: row.type,
      url,
      thumbnailUrl,
      blurhash: row.blurhash,
      caption: row.caption,
      width: row.width,
      height: row.height,
      durationSeconds: row.durationSeconds,
      sizeBytes: row.sizeBytes,
      commentCount,
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
}
