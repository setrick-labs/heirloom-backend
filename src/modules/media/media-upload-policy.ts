import { BadRequestException } from '@nestjs/common';

const MEGABYTE = 1024 * 1024;

// Conservative defaults — R2's free tier is 10GB/month, so we'd rather
// reject an oversized upload up front than eat storage on one file.
export const MAX_IMAGE_SIZE_BYTES = 20 * MEGABYTE;
export const MAX_VIDEO_SIZE_BYTES = 300 * MEGABYTE;
// Milestones spec Section 4: voice-note comments — a spoken message, not a
// music file, so a much tighter cap than video makes sense.
export const MAX_AUDIO_SIZE_BYTES = 20 * MEGABYTE;

/** contentType -> file extension. Also doubles as the upload MIME allow-list. */
export const ALLOWED_MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  // expo-audio's default recording presets produce these.
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

function isImageMimeType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

function isAudioMimeType(contentType: string): boolean {
  return contentType.startsWith('audio/');
}

/**
 * Validates a requested upload against the MIME allow-list and the
 * size cap for its media kind, throwing a 400 with a clear reason if not.
 * Returns the file extension to use for the storage key on success.
 *
 * This only rejects the *request* for a presigned URL — a presigned PUT
 * can't itself enforce Content-Length at the storage layer, so this check
 * is the actual guardrail, not R2.
 */
export function assertValidMediaUpload(
  contentType: string,
  sizeBytes: number,
): string {
  const extension = ALLOWED_MEDIA_MIME_TYPES[contentType];
  if (!extension) {
    throw new BadRequestException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported content type "${contentType}". Allowed: ${Object.keys(ALLOWED_MEDIA_MIME_TYPES).join(', ')}`,
    });
  }

  const kind = isImageMimeType(contentType) ? 'images' : isAudioMimeType(contentType) ? 'audio' : 'videos';
  const maxSizeBytes = isImageMimeType(contentType)
    ? MAX_IMAGE_SIZE_BYTES
    : isAudioMimeType(contentType)
      ? MAX_AUDIO_SIZE_BYTES
      : MAX_VIDEO_SIZE_BYTES;
  if (sizeBytes > maxSizeBytes) {
    throw new BadRequestException({
      code: 'MEDIA_TOO_LARGE',
      message: `File is too large (${Math.ceil(sizeBytes / MEGABYTE)}MB). Max is ${Math.floor(maxSizeBytes / MEGABYTE)}MB for ${kind}.`,
    });
  }

  return extension;
}
