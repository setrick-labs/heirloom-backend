import { BadRequestException } from '@nestjs/common';

import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_AUDIO_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  assertValidMediaUpload,
} from './media-upload-policy';

const MB = 1024 * 1024;

describe('assertValidMediaUpload', () => {
  describe('MIME allow-list', () => {
    it.each(Object.entries(ALLOWED_MEDIA_MIME_TYPES))(
      'accepts %s and maps it to .%s',
      (contentType, extension) => {
        expect(assertValidMediaUpload(contentType, 1024)).toBe(extension);
      },
    );

    it.each([
      'image/gif',
      'image/svg+xml',
      'application/pdf',
      'text/html',
      'video/x-msvideo',
      '',
    ])('rejects %s', (contentType) => {
      expect(() => assertValidMediaUpload(contentType, 1024)).toThrow(
        BadRequestException,
      );
    });

    it('reports UNSUPPORTED_MEDIA_TYPE so the client can branch on a code', () => {
      try {
        assertValidMediaUpload('image/gif', 1024);
        fail('expected a rejection');
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'UNSUPPORTED_MEDIA_TYPE',
        });
      }
    });

    it('is case-sensitive — a normalised content type is the caller\'s job', () => {
      expect(() => assertValidMediaUpload('IMAGE/JPEG', 1024)).toThrow();
    });
  });

  describe('size caps', () => {
    it('accepts an image exactly at the cap', () => {
      expect(assertValidMediaUpload('image/jpeg', MAX_IMAGE_SIZE_BYTES)).toBe('jpg');
    });

    it('rejects an image one byte over', () => {
      expect(() =>
        assertValidMediaUpload('image/jpeg', MAX_IMAGE_SIZE_BYTES + 1),
      ).toThrow(BadRequestException);
    });

    it('applies the video cap to video, not the image cap', () => {
      // 100MB is over the image cap but well under the video one — proof the
      // kind is chosen from the MIME type rather than a single global limit.
      expect(assertValidMediaUpload('video/mp4', 100 * MB)).toBe('mp4');
      expect(() => assertValidMediaUpload('image/png', 100 * MB)).toThrow();
    });

    it('applies the tighter audio cap to voice notes', () => {
      expect(assertValidMediaUpload('audio/m4a', MAX_AUDIO_SIZE_BYTES)).toBe('m4a');
      expect(() =>
        assertValidMediaUpload('audio/m4a', MAX_AUDIO_SIZE_BYTES + 1),
      ).toThrow();
      // audio/mp4 must be treated as audio despite the mp4 spelling, or a
      // voice note would silently get the 300MB video allowance.
      expect(() => assertValidMediaUpload('audio/mp4', 100 * MB)).toThrow();
    });

    it('reports MEDIA_TOO_LARGE with the limit in the message', () => {
      try {
        assertValidMediaUpload('image/jpeg', MAX_IMAGE_SIZE_BYTES + 1);
        fail('expected a rejection');
      } catch (error) {
        const response = (error as BadRequestException).getResponse() as {
          code: string;
          message: string;
        };
        expect(response.code).toBe('MEDIA_TOO_LARGE');
        expect(response.message).toContain('images');
      }
    });

    it('accepts a zero-byte declaration — the cap is an upper bound only', () => {
      expect(assertValidMediaUpload('image/jpeg', 0)).toBe('jpg');
    });
  });

  describe('cap ordering', () => {
    it('keeps video the most permissive and audio no looser than image', () => {
      expect(MAX_VIDEO_SIZE_BYTES).toBeGreaterThan(MAX_IMAGE_SIZE_BYTES);
      expect(MAX_AUDIO_SIZE_BYTES).toBeLessThanOrEqual(MAX_IMAGE_SIZE_BYTES);
    });
  });
});
