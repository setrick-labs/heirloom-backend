import { StorageKeys } from './storage-keys.util';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe('StorageKeys', () => {
  describe('journeyMedia', () => {
    const params = {
      familyId: 'fam-1',
      journeyId: 'jrn-1',
      milestoneId: 'mst-1',
      extension: 'jpg',
    };

    it('nests family/journey/milestone so a prefix walk scopes correctly', () => {
      expect(StorageKeys.journeyMedia(params)).toMatch(
        new RegExp(`^fam-1/jrn-1/mst-1/${UUID.source}\\.jpg$`),
      );
    });

    it('never collides across calls with identical params', () => {
      const keys = new Set(
        Array.from({ length: 100 }, () => StorageKeys.journeyMedia(params)),
      );
      expect(keys.size).toBe(100);
    });
  });

  describe('cover', () => {
    it('namespaces under covers/ so a journey media prefix walk never picks it up', () => {
      const key = StorageKeys.cover({
        scope: 'journey',
        targetId: 'jrn-1',
        extension: 'png',
      });
      expect(key.startsWith('covers/journey/jrn-1/')).toBe(true);
      // The guarantee that matters: a cover key must not look like a media
      // key for the same id, or listing a journey's media would return it.
      expect(key.startsWith('jrn-1/')).toBe(false);
    });
  });

  describe('mediaVariant', () => {
    it('keeps the variant beside the original, same uuid, .webp extension', () => {
      const original = 'fam/jrn/mst/abc-123.jpg';
      expect(StorageKeys.mediaVariant(original, 'thumb')).toBe(
        'fam/jrn/mst/abc-123-thumb.webp',
      );
      expect(StorageKeys.mediaVariant(original, 'display')).toBe(
        'fam/jrn/mst/abc-123-display.webp',
      );
    });

    it('is deterministic — the pipeline relies on recomputing, not storing, these', () => {
      const original = 'fam/jrn/mst/abc-123.heic';
      expect(StorageKeys.mediaVariant(original, 'thumb')).toBe(
        StorageKeys.mediaVariant(original, 'thumb'),
      );
    });

    it('handles a key with no extension rather than truncating it', () => {
      expect(StorageKeys.mediaVariant('fam/jrn/mst/abc-123', 'thumb')).toBe(
        'fam/jrn/mst/abc-123-thumb.webp',
      );
    });

    it('only strips the final extension when the path contains dots', () => {
      expect(StorageKeys.mediaVariant('fam/my.photos/a.b.jpg', 'display')).toBe(
        'fam/my.photos/a.b-display.webp',
      );
    });

    it('does not produce the same key for both variants', () => {
      const original = 'fam/jrn/mst/abc.jpg';
      expect(StorageKeys.mediaVariant(original, 'thumb')).not.toBe(
        StorageKeys.mediaVariant(original, 'display'),
      );
    });
  });

  describe('hasUnrenderableExtension', () => {
    // This gates MediaService.toDto's 422. A false negative serves a broken
    // image; a false positive hides a perfectly good photo.
    it.each(['a.heic', 'a.HEIC', 'a.heif', 'a.HEIF', 'fam/jrn/mst/x.Heic'])(
      'flags %s',
      (key) => {
        expect(StorageKeys.hasUnrenderableExtension(key)).toBe(true);
      },
    );

    it.each(['a.jpg', 'a.png', 'a.webp', 'a.mp4', 'a.m4a', 'a-thumb.webp'])(
      'does not flag %s',
      (key) => {
        expect(StorageKeys.hasUnrenderableExtension(key)).toBe(false);
      },
    );

    it('anchors to the end — "heic" inside a path is not an extension', () => {
      expect(StorageKeys.hasUnrenderableExtension('heic/photos/a.jpg')).toBe(false);
      expect(StorageKeys.hasUnrenderableExtension('a.heic.jpg')).toBe(false);
    });

    it('agrees with mediaVariant: a HEIC variant key is itself renderable', () => {
      // Once processing succeeds, the variant is .webp — so the 422 path must
      // not fire on a media row that actually has variants.
      const variant = StorageKeys.mediaVariant('fam/jrn/mst/a.heic', 'display');
      expect(StorageKeys.hasUnrenderableExtension(variant)).toBe(false);
    });
  });
});
