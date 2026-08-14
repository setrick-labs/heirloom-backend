import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { env } from '../../config/env';

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 300;
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
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }
}
