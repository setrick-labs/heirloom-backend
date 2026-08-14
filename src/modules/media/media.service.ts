import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

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
    return Promise.all(rows.map((row) => this.toDto(row)));
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
    return this.toDto(row);
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

  private async toDto(row: typeof media.$inferSelect): Promise<Media> {
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
      createdAt: row.createdAt.toISOString(),
    };
  }
}
