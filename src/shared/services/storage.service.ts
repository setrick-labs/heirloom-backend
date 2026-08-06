import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
 * Thin wrapper around Cloudflare R2 — R2 is S3-compatible, so this is just
 * the standard AWS SDK v3 pointed at R2's endpoint (region 'auto'), not an
 * R2-specific SDK.
 *
 * R2 env vars are optional at boot (see config/env.ts) so the app can start
 * without them configured; every method here throws a clear, actionable
 * error the first time something actually tries to use storage while unset.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | undefined;

  constructor() {
    if (
      env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME
    ) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      });
      this.bucket = env.R2_BUCKET_NAME;
    } else {
      this.client = null;
      this.logger.warn(
        'R2 credentials are not configured — StorageService will throw if used. ' +
          'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME to enable it.',
      );
    }
  }

  private requireClient(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new InternalServerErrorException(
        'Object storage is not configured on this server (missing R2 env vars).',
      );
    }
    return { client: this.client, bucket: this.bucket };
  }

  /**
   * Presigned PUT URL so the mobile app can upload the file bytes directly
   * to R2 — they never route through this server. Note: a presigned PUT
   * cannot itself enforce a max Content-Length; size limits are enforced as
   * an API-level check before this URL is ever issued (see
   * modules/media/media-upload-policy.ts), not by R2 at upload time.
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
   * Public CDN URL for non-sensitive media, if R2_PUBLIC_URL (a public
   * bucket URL or custom domain) is configured. Returns null rather than
   * throwing when it isn't — callers should fall back to
   * generatePresignedDownloadUrl in that case.
   */
  buildPublicUrl(key: string): string | null {
    if (!env.R2_PUBLIC_URL) {
      return null;
    }
    return `${env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`;
  }
}
