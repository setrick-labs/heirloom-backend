import type { StorageService } from '../services/storage.service';
import {
  copyVariants,
  resolveVariantUrls,
  storedKeysOf,
  type StoredVariants,
} from './media-variants.util';

/** Signs a key as `signed:<key>`, and records copies. */
function fakeStorage() {
  const copies: [string, string][] = [];
  const storage = {
    generatePresignedDownloadUrl: (key: string) =>
      Promise.resolve(`signed:${key}`),
    copyObject: (from: string, to: string) => {
      copies.push([from, to]);
      return Promise.resolve();
    },
  } as unknown as StorageService;
  return { storage, copies };
}

const unprocessed = (
  type: StoredVariants['type'],
  storageKey: string,
): StoredVariants => ({
  type,
  storageKey,
  thumbnailStorageKey: null,
  displayStorageKey: null,
  zoomStorageKey: null,
  posterStorageKey: null,
});

const processedVideo: StoredVariants = {
  type: 'video',
  storageKey: 'u/vault/abc.mov',
  thumbnailStorageKey: 'u/vault/abc-thumb.webp',
  displayStorageKey: 'u/vault/abc-display.mp4',
  zoomStorageKey: null,
  posterStorageKey: 'u/vault/abc-poster.webp',
};

describe('resolveVariantUrls', () => {
  it('serves a processed video as its streaming copy, with poster and thumb', async () => {
    const { storage } = fakeStorage();
    expect(await resolveVariantUrls(storage, processedVideo)).toEqual({
      url: 'signed:u/vault/abc-display.mp4',
      thumbnailUrl: 'signed:u/vault/abc-thumb.webp',
      zoomUrl: null,
      posterUrl: 'signed:u/vault/abc-poster.webp',
    });
  });

  it('never hands an unprocessed video over as its own thumbnail', async () => {
    const { storage } = fakeStorage();
    const urls = await resolveVariantUrls(
      storage,
      unprocessed('video', 'k/v.mov'),
    );
    expect(urls.url).toBe('signed:k/v.mov');
    expect(urls.thumbnailUrl).toBeNull();
    expect(urls.posterUrl).toBeNull();
  });

  it('falls back to the original for an unprocessed photo', async () => {
    const { storage } = fakeStorage();
    const urls = await resolveVariantUrls(
      storage,
      unprocessed('image', 'k/p.jpg'),
    );
    expect(urls.url).toBe('signed:k/p.jpg');
    expect(urls.thumbnailUrl).toBe('signed:k/p.jpg');
    expect(urls.zoomUrl).toBeNull();
  });
});

describe('storedKeysOf', () => {
  it('lists the original and every variant that exists', () => {
    expect(storedKeysOf(processedVideo)).toEqual([
      'u/vault/abc.mov',
      'u/vault/abc-thumb.webp',
      'u/vault/abc-display.mp4',
      'u/vault/abc-poster.webp',
    ]);
  });
});

describe('copyVariants', () => {
  it('copies each variant beside the new original, keeping its format', async () => {
    const { storage, copies } = fakeStorage();
    const keys = await copyVariants(storage, processedVideo, 'u/vault/new.mov');
    expect(keys).toEqual({
      thumbnailStorageKey: 'u/vault/new-thumb.webp',
      displayStorageKey: 'u/vault/new-display.mp4',
      zoomStorageKey: null,
      posterStorageKey: 'u/vault/new-poster.webp',
    });
    expect(copies).toHaveLength(3);
  });
});
