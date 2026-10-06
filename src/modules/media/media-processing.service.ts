import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { encode } from 'blurhash';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';

import { DATABASE_CONNECTION } from '../../database/database.module';
import type { Database } from '../../database/connection';
import { media, sharedVaultItems, vaultItems } from '../../database/schema';
import { StorageKeys } from '../../shared/services/storage-keys.util';
import { StorageService } from '../../shared/services/storage.service';
import type { MediaType } from './validations/media.schema';
import {
  canTonemap,
  encodeVideo,
  extractPosterFrame,
  planVideoEncode,
  probeVideo,
} from './video-transcode';

// Matches the actual max render sizes across the app (grid tiles, 76px
// comment thumbnails, and the 100%-width/160pt-tall milestone image panel)
// with headroom for retina density — not the 3-tier thumb/feed/full split
// a chronological Instagram-style feed would want, because nothing here
// ever displays a photo larger than roughly a phone's screen width.
const THUMB_WIDTH = 240;
const DISPLAY_WIDTH = 960;
const WEBP_QUALITY = 75;
// The pinch-zoom copy. Only made when the original is meaningfully wider
// than the display variant — below that, zooming the display copy is as
// sharp as the source allows, and a second near-identical file is waste.
const ZOOM_WIDTH = 2048;
const ZOOM_WEBP_QUALITY = 80;
const ZOOM_MIN_SOURCE_WIDTH = DISPLAY_WIDTH * 1.5;
// Blurhash components — 4x3 is the standard "enough detail, still tiny" split.
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

/** Wide enough for a full-screen player on any phone, at the display variant's width. */
const POSTER_WIDTH = DISPLAY_WIDTH;

/** What a video has once its poster frame exists — before the encode. */
export interface VideoPoster {
  posterStorageKey: string;
  thumbnailStorageKey: string;
  blurhash: string;
  width: number;
  height: number;
  /** Null when the container doesn't say. */
  durationSeconds: number | null;
}

export interface ProcessedVideo extends VideoPoster {
  displayStorageKey: string;
}

/**
 * Which table a processed original belongs to. All three carry the same
 * variant columns; Vault content is also stored with private caching.
 */
export type ProcessingTarget = 'media' | 'vault' | 'sharedVault';

/** The columns processing writes, common to all three tables. */
type ProcessedColumns = Partial<{
  thumbnailStorageKey: string | null;
  displayStorageKey: string | null;
  zoomStorageKey: string | null;
  posterStorageKey: string | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  processingStatus: 'pending' | 'done' | 'failed';
}>;

export interface ProcessedImage {
  thumbnailStorageKey: string;
  displayStorageKey: string;
  zoomStorageKey: string | null;
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
   * place. Images get resized stills; videos a poster and a streaming MP4
   * (see video-transcode.ts); audio is a no-op.
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
    target: ProcessingTarget = 'media',
  ): Promise<void> {
    if (type === 'image') return this.persistImage(target, mediaId, storageKey);
    if (type === 'video') return this.persistVideo(target, mediaId, storageKey);
  }

  /** Writes processing output onto whichever table the row lives in. */
  private async save(
    target: ProcessingTarget,
    id: string,
    values: ProcessedColumns,
  ): Promise<void> {
    if (target === 'vault') {
      await this.db.update(vaultItems).set(values).where(eq(vaultItems.id, id));
    } else if (target === 'sharedVault') {
      await this.db
        .update(sharedVaultItems)
        .set(values)
        .where(eq(sharedVaultItems.id, id));
    } else {
      await this.db.update(media).set(values).where(eq(media.id, id));
    }
  }

  private async persistImage(
    target: ProcessingTarget,
    mediaId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      const result = await this.processImage(storageKey, target !== 'media');
      if (!result) {
        await this.markFailed(target, mediaId);
        return;
      }
      await this.save(target, mediaId, { ...result, processingStatus: 'done' });
    } catch (error) {
      this.logger.warn(
        `Failed to persist processed variants for ${target} ${mediaId}: ${error}`,
      );
      await this.markFailed(target, mediaId);
    }
  }

  /**
   * One video at a time, across the whole process. A transcode uses every
   * core it can get for up to minutes; two at once on the API's own
   * instance would make every other request crawl. Later uploads wait their
   * turn — each still plays from its original in the meantime.
   */
  private videoQueue: Promise<void> = Promise.resolve();

  private persistVideo(
    target: ProcessingTarget,
    mediaId: string,
    storageKey: string,
  ): Promise<void> {
    const job = this.videoQueue.then(async () => {
      try {
        // Saved the moment it exists, still 'pending': tiles and the player
        // get a real frame while the encode is still running.
        const savePoster = (poster: VideoPoster) => this.save(target, mediaId, poster);
        const result = await this.processVideo(
          storageKey,
          target !== 'media',
          savePoster,
        );
        if (!result) {
          await this.markFailed(target, mediaId);
          return;
        }
        await this.save(target, mediaId, { ...result, processingStatus: 'done' });
      } catch (error) {
        this.logger.warn(
          `Failed to persist processed video for ${target} ${mediaId}: ${error}`,
        );
        await this.markFailed(target, mediaId);
      }
    });
    // The queue never rejects, so one bad video can't stall the ones after it.
    this.videoQueue = job.catch(() => {});
    return job;
  }

  /** Best-effort — if even this update fails, the row is left 'pending' and scripts/retry-failed-media.ts still picks it up via the stuck-pending check. */
  private async markFailed(target: ProcessingTarget, mediaId: string): Promise<void> {
    try {
      await this.save(target, mediaId, { processingStatus: 'failed' });
    } catch (error) {
      this.logger.warn(
        `Failed to mark ${target} ${mediaId} as processing_status='failed': ${error}`,
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
    isPrivate: boolean,
  ): Promise<ProcessedImage | null> {
    try {
      const original = await this.storageService.getObjectBuffer(originalKey);
      const image = sharp(original, { failOn: 'none' }).rotate();
      const metadata = await image.metadata();
      // EXIF orientations 5–8 are rotated 90°, so the stored width is the
      // displayed height — measure the side `resize({ width })` will act on.
      const uprightWidth =
        (metadata.orientation ?? 1) >= 5 ? metadata.height : metadata.width;
      const wantsZoom = (uprightWidth ?? 0) >= ZOOM_MIN_SOURCE_WIDTH;

      const [thumbBuffer, displayBuffer, zoomBuffer, blurhash] = await Promise.all([
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
        wantsZoom
          ? image
              .clone()
              .resize({ width: ZOOM_WIDTH, withoutEnlargement: true })
              .webp({ quality: ZOOM_WEBP_QUALITY })
              .toBuffer()
          : Promise.resolve(null),
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

      const zoomStorageKey = zoomBuffer
        ? StorageKeys.mediaVariant(originalKey, 'zoom')
        : null;

      await Promise.all([
        this.storageService.putObject(
          thumbnailStorageKey,
          thumbBuffer,
          'image/webp', { private: isPrivate }
        ),
        this.storageService.putObject(
          displayStorageKey,
          displayBuffer,
          'image/webp', { private: isPrivate }
        ),
        zoomBuffer && zoomStorageKey
          ? this.storageService.putObject(zoomStorageKey, zoomBuffer, 'image/webp', { private: isPrivate })
          : Promise.resolve(),
      ]);

      return {
        thumbnailStorageKey,
        displayStorageKey,
        zoomStorageKey,
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

  /**
   * The video counterpart of processImage: pulls the original to local disk
   * (too big to hold in memory), takes a poster frame and builds the poster,
   * thumb and blurhash from it, then writes a streaming MP4 — remuxed when
   * the upload already qualifies, transcoded otherwise. Returns null rather
   * than throwing, like processImage; the original keeps playing either way.
   *
   * The original stays in the bucket untouched. It is the family's copy of
   * the moment; the MP4 is only how it gets watched.
   */
  private async processVideo(
    originalKey: string,
    isPrivate: boolean,
    onPoster: (poster: VideoPoster) => Promise<unknown>,
  ): Promise<ProcessedVideo | null> {
    const workDir = await mkdtemp(join(tmpdir(), 'heirloom-video-'));
    try {
      const input = join(workDir, 'original');
      const framePath = join(workDir, 'frame.png');
      const output = join(workDir, 'stream.mp4');

      await this.storageService.downloadToFile(originalKey, input);
      const probe = await probeVideo(input);
      const tonemap = await canTonemap();

      await extractPosterFrame(input, framePath, probe, tonemap);
      const frame = sharp(framePath);
      const [posterBuffer, thumbBuffer, blurhash] = await Promise.all([
        frame
          .clone()
          .resize({ width: POSTER_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
        frame
          .clone()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
        this.computeBlurhash(frame),
      ]);

      const posterStorageKey = StorageKeys.mediaVariant(originalKey, 'poster');
      const thumbnailStorageKey = StorageKeys.mediaVariant(originalKey, 'thumb');
      // The poster goes up before the encode starts: a tile can show a real
      // frame minutes before the streaming copy is ready.
      await Promise.all([
        this.storageService.putObject(posterStorageKey, posterBuffer, 'image/webp', { private: isPrivate }),
        this.storageService.putObject(thumbnailStorageKey, thumbBuffer, 'image/webp', { private: isPrivate }),
      ]);
      const plan = planVideoEncode(probe);
      const poster: VideoPoster = {
        posterStorageKey,
        thumbnailStorageKey,
        blurhash,
        ...(plan.mode === 'transcode'
          ? { width: plan.width, height: plan.height }
          : { width: probe.width, height: probe.height }),
        // Whole seconds, as the column is; a sub-second clip still has one.
        durationSeconds:
          probe.durationSeconds > 0 ? Math.max(1, Math.round(probe.durationSeconds)) : null,
      };
      await onPoster(poster);

      await encodeVideo(input, output, plan, tonemap);
      const displayStorageKey = StorageKeys.mediaVariant(
        originalKey,
        'display',
        'mp4',
      );
      await this.storageService.putFile(displayStorageKey, output, 'video/mp4', {
        private: isPrivate,
      });

      return { ...poster, displayStorageKey };
    } catch (error) {
      this.logger.warn(`Failed to process video ${originalKey}: ${error}`);
      return null;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
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
