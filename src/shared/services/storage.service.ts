import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { env } from '../../config/env';

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 300;

export interface PutOptions {
  /**
   * Vault content. Still cached for good by the device that fetched it, but
   * marked `private` so no shared cache between here and there — a CDN, a
   * proxy — may keep a copy.
   */
  private?: boolean;
}

function cacheControlFor({ private: isPrivate }: PutOptions): string {
  return `${isPrivate ? 'private' : 'public'}, max-age=31536000, immutable`;
}
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 3600;

/**
 * Thin wrapper around whatever S3-compatible object store is configured —
 * just the standard AWS SDK v3 pointed at that provider's endpoint, not a
 * provider-specific SDK. Cloudflare R2 is the intended production target,
 * but the endpoint is fully overridable (S3_ENDPOINT) so a self-hosted
 * S3-compatible service (SeaweedFS, MinIO, ...) works identically during
 * development — same code path, same interface, swap env vars only when R2
 * is actually set up.
 *
 * These env vars are optional at boot (see config/env.ts) so the app can
 * start without them configured; every method here throws a clear,
 * actionable error the first time something actually tries to use storage
 * while unset.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | undefined;

  constructor() {
    if (
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY &&
      env.S3_BUCKET_NAME
    ) {
      this.client = new S3Client({
        region: env.AWS_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      });
      this.bucket = env.S3_BUCKET_NAME;
    } else {
      this.client = null;
      this.logger.warn(
        'Object storage is not configured — StorageService will throw if used. ' +
          'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME (and S3_ENDPOINT, unless using real AWS S3) to enable it.',
      );
    }
  }

  /** Whether the S3 env vars are present. Lets callers distinguish
   *  "not set up" from "set up but unreachable" — see HealthService. */
  get isConfigured(): boolean {
    return Boolean(this.client && this.bucket);
  }

  private requireClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new InternalServerErrorException(
        'Object storage is not configured on this server (missing AWS/S3 env vars).',
      );
    }
    return { client: this.client, bucket: this.bucket };
  }

  /**
   * Confirms the bucket is reachable with the configured credentials —
   * doesn't touch any object, just proves the connection/auth/bucket-name
   * are all correct. Used by scripts/verify-storage.ts.
   */
  async checkConnection(): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  }

  /**
   * Presigned PUT URL so the mobile app can upload the file bytes directly
   * to the bucket — they never route through this server. Note: a presigned
   * PUT cannot itself enforce a max Content-Length; size limits are
   * enforced as an API-level check before this URL is ever issued (see
   * modules/media/media-upload-policy.ts), not by the storage provider at
   * upload time.
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = DEFAULT_UPLOAD_URL_TTL_SECONDS,
  ): Promise<string> {
    const { client, bucket } = this.requireClient();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  /** For private vault / gated media that isn't served from a public bucket URL. */
  async generatePresignedDownloadUrl(
    key: string,
    expiresInSeconds = DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  ): Promise<string> {
    const { client, bucket } = this.requireClient();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Server-side copy for a Vault ↔ Milestone move — the object relocates to
   * the destination's key namespace without its bytes ever transiting this
   * server (S3-compatible providers copy the object internally). The
   * caller still owns deciding what happens to the source object
   * afterwards; this never deletes it.
   */
  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        // CopySource is `{bucket}/{key}`, with the key URI-encoded per the
        // S3 API's own requirement — not the same encoding `Key` gets.
        CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
        Key: destinationKey,
      }),
    );
  }

  /**
   * Server-side fetch of an object's bytes — used only by
   * MediaProcessingService right after a client's direct-to-bucket upload
   * completes, to generate resized variants + a blurhash. Everything else
   * in the app deliberately avoids routing file bytes through this server.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const { client, bucket } = this.requireClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const stream = result.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
    options: PutOptions = {},
  ): Promise<void> {
    const { client, bucket } = this.requireClient();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Variant keys are content-addressed (derived from the immutable
        // original's key) and never rewritten in place — safe to cache
        // for as long as a client wants to.
        CacheControl: cacheControlFor(options),
      }),
    );
  }

  /**
   * getObjectBuffer for objects too big to hold in memory — a 300MB video.
   * Streams the object straight to `path` on local disk; the caller owns
   * the file and its cleanup.
   */
  async downloadToFile(key: string, path: string): Promise<void> {
    const { client, bucket } = this.requireClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    await pipeline(result.Body as Readable, createWriteStream(path));
  }

  /** putObject from a file on local disk, streamed rather than read into memory. */
  async putFile(
    key: string,
    path: string,
    contentType: string,
    options: PutOptions = {},
  ): Promise<void> {
    const { client, bucket } = this.requireClient();
    const { size } = await stat(path);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(path),
        // A stream has no length of its own; S3-compatible stores reject a
        // PUT without one rather than buffer it to find out.
        ContentLength: size,
        ContentType: contentType,
        // Same immutable-variant rule as putObject.
        CacheControl: cacheControlFor(options),
      }),
    );
  }
}
