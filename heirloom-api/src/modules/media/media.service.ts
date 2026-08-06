import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { media } from '../../database/schema';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
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
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Step 1 of upload: validate the declared content type/size, mint a
   * {familyId}/{journeyId}/{milestoneId}/{uuid}.{ext} key, and hand back a
   * presigned PUT URL. The client uploads bytes straight to R2 — they never
   * pass through this server.
   */
  async requestUploadUrl(
    input: RequestUploadUrlInput,
  ): Promise<RequestUploadUrlResult> {
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

  /** Step 2: after the client finishes the direct upload, register the row using the returned key. */
  async create(ownerId: string, input: CreateMediaInput): Promise<Media> {
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
    return this.toDto(created);
  }

  async listByFamily(familyId: string): Promise<Media[]> {
    const rows = await this.db.query.media.findMany({
      where: eq(media.familyId, familyId),
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async findById(id: string): Promise<Media> {
    const row = await this.db.query.media.findFirst({
      where: eq(media.id, id),
    });
    if (!row) {
      throw new NotFoundException('Media not found');
    }
    return this.toDto(row);
  }

  /** Resolves a servable URL for the stored key: public CDN if configured, else a fresh presigned download URL. */
  private async resolveUrl(storageKey: string): Promise<string> {
    return (
      this.storageService.buildPublicUrl(storageKey) ??
      this.storageService.generatePresignedDownloadUrl(storageKey)
    );
  }

  private async toDto(row: typeof media.$inferSelect): Promise<Media> {
    return {
      id: row.id,
      familyId: row.familyId,
      ownerId: row.ownerId,
      type: row.type,
      url: await this.resolveUrl(row.storageKey),
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      width: row.width,
      height: row.height,
      durationSeconds: row.durationSeconds,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
