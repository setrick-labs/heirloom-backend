import { Inject, Injectable, Logger } from '@nestjs/common';
import { encode } from 'blurhash';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { media } from '../../database/schema';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import type { MediaType } from './validations/media.schema';

// Matches the actual max render sizes across the app (grid tiles, 76px
// comment thumbnails, and the 100%-width/160pt-tall milestone image panel)
// with headroom for retina density — not the 3-tier thumb/feed/full split
// a chronological Instagram-style feed would want, because nothing here
// ever displays a photo larger than roughly a phone's screen width.
const THUMB_WIDTH = 240;
const DISPLAY_WIDTH = 960;
const WEBP_QUALITY = 75;
// Blurhash components — 4x3 is the standard "enough detail, still tiny" split.
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

export interface ProcessedImage {
  thumbnailStorageKey: string;
  displayStorageKey: string;
  blurhash: string;
  width: number;
  height: number;
}

@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Runs image processing for a just-registered media row and persists the
   * result directly (variant keys, blurhash, width/height) — the one entry
   * point both MediaService.create() (adding media to an existing
   * Milestone) and MilestonesService.create() (a new Milestone's first
   * media) call after their insert, so the pipeline lives in exactly one
   * place. Non-image types are a no-op.
   *
   * Deliberately fire-and-forget from both call sites (`void this.media
   * ProcessingService.processAndPersist(...)`, not awaited) — there's no
   * job queue in this stack, but the upload-confirmation response must not
   * wait on a multi-second fetch+resize+upload round trip just to hand
   * back a DTO that already has a perfectly good fallback (the original).
   * That makes this promise's rejection unobservable by any caller, so it
   * must genuinely never throw: every step is wrapped here, not left to
   * the caller. A crash mid-processing just leaves that one photo without
   * variants forever — toDto() falls back to serving the original in that
   * case, so it's a missed optimization, never a broken image.
   */
  async processAndPersist(
    mediaId: string,
    storageKey: string,
    type: MediaType,
  ): Promise<void> {
    if (type !== 'image') return;
    try {
      const result = await this.processImage(storageKey);
      if (!result) return;
      await this.db
        .update(media)
        .set({
          thumbnailStorageKey: result.thumbnailStorageKey,
          displayStorageKey: result.displayStorageKey,
          blurhash: result.blurhash,
          width: result.width,
          height: result.height,
        })
        .where(eq(media.id, mediaId));
    } catch (error) {
      this.logger.warn(
        `Failed to persist processed variants for media ${mediaId}: ${error}`,
      );
    }
  }

  /**
   * Runs right after MediaService.create() registers a freshly
   * direct-to-bucket-uploaded image: fetches the original back from
   * storage, produces thumb/display WebP variants + a blurhash, and
   * uploads the variants alongside the original. Returns null (rather than
   * throwing) on any failure — a slow/failed variant pass should never
   * block the upload the user is waiting on; toDto() falls back to serving
   * the original when a variant key is missing.
   */
  private async processImage(
    originalKey: string,
  ): Promise<ProcessedImage | null> {
    try {
      const original = await this.storageService.getObjectBuffer(originalKey);
      const image = sharp(original, { failOn: 'none' }).rotate();
      const metadata = await image.metadata();

      const [thumbBuffer, displayBuffer, blurhash] = await Promise.all([
        image
          .clone()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
        image
          .clone()
          .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
        this.computeBlurhash(image),
      ]);

      const thumbnailStorageKey = StorageKeys.mediaVariant(
        originalKey,
        'thumb',
      );
      const displayStorageKey = StorageKeys.mediaVariant(
        originalKey,
        'display',
      );

      await Promise.all([
        this.storageService.putObject(
          thumbnailStorageKey,
          thumbBuffer,
          'image/webp',
        ),
        this.storageService.putObject(
          displayStorageKey,
          displayBuffer,
          'image/webp',
        ),
      ]);

      return {
        thumbnailStorageKey,
        displayStorageKey,
        blurhash,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to process image variants for ${originalKey}: ${error}`,
      );
      return null;
    }
  }

  /** Blurhash is computed from a tiny raw-pixel downscale — cheap regardless of the original's size. */
  private async computeBlurhash(image: sharp.Sharp): Promise<string> {
    const BLURHASH_SOURCE_SIZE = 32;
    const { data, info } = await image
      .clone()
      .resize(BLURHASH_SOURCE_SIZE, BLURHASH_SOURCE_SIZE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return encode(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      BLURHASH_COMPONENTS_X,
      BLURHASH_COMPONENTS_Y,
    );
  }
}
