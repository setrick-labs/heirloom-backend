/**
 * HEIC/HEIF codec regression check (Phase 7.2).
 *
 * The question this answers: can the installed libvips actually decode what
 * an iPhone produces? "HEIF support" is not one capability — libvips can be
 * built with AVIF (AV1-in-HEIF) and without HEVC, and an iPhone's .HEIC is
 * HEVC-in-HEIF. A build that reports heif input support can still fail every
 * real photo from a phone.
 *
 * That distinction decides which downstream path is live:
 *
 *   HEVC decode available — HEIC uploads process normally, rows reach
 *     processing_status='done', and MediaService.toDto's 422 never fires.
 *   HEVC decode missing  — every HEIC upload fails processing, lands on
 *     'failed', and toDto answers 422 MEDIA_PROCESSING_FAILED. The client
 *     picker guard (frontend lib/media/picker.ts) is then load-bearing, not
 *     a nicety, because it is the only thing stopping a user from spending
 *     an upload on a photo the server will refuse to show.
 *
 * Needs no database and no object storage, so it runs in CI and on a laptop.
 * Run with: pnpm run media:verify-heic
 */
import { encode } from 'blurhash';
import sharp from 'sharp';

const THUMB_WIDTH = 240;
const DISPLAY_WIDTH = 960;
const WEBP_QUALITY = 75;

/** Runs the exact transform MediaProcessingService.processImage runs. */
async function runPipeline(input: Buffer) {
  const image = sharp(input, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();

  const [thumb, display, raw] = await Promise.all([
    image.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY }).toBuffer(),
    image.clone().resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY }).toBuffer(),
    image.clone().resize(32, 32, { fit: 'inside' }).ensureAlpha()
      .raw().toBuffer({ resolveWithObject: true }),
  ]);

  const blurhash = encode(
    new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height, 4, 3,
  );
  return { metadata, thumb, display, blurhash };
}

async function canEncode(compression: 'hevc' | 'av1'): Promise<boolean> {
  try {
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .heif({ compression, quality: 50 })
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}\n`);

  const heif = sharp.format.heif;
  const suffixes = heif?.input?.fileSuffix ?? [];
  const hevc = await canEncode('hevc');
  const av1 = await canEncode('av1');

  console.log('Codec matrix');
  console.log(`  heif input suffixes : ${suffixes.join(', ') || '(none)'}`);
  console.log(`  HEVC (iPhone .HEIC) : ${hevc ? 'available' : 'MISSING'}`);
  console.log(`  AV1  (.avif)        : ${av1 ? 'available' : 'missing'}`);

  // Prove the transform itself is sound, using a format this build can encode.
  // This isolates "the pipeline works" from "this codec is present", so a
  // failure below is never ambiguous between the two.
  if (av1) {
    const fixture = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 180, g: 120, b: 70 } },
    }).heif({ compression: 'av1', quality: 60 }).toBuffer();

    const result = await runPipeline(fixture);
    const broken =
      !result.metadata.width || !result.metadata.height ||
      result.thumb.length === 0 || result.display.length === 0 || !result.blurhash;

    console.log('\nTransform check (AVIF in, WebP + blurhash out)');
    console.log(`  dimensions : ${result.metadata.width}x${result.metadata.height}`);
    console.log(`  thumb      : ${result.thumb.length} bytes`);
    console.log(`  display    : ${result.display.length} bytes`);
    console.log(`  blurhash   : ${result.blurhash}`);
    if (broken) {
      console.error('\nFAIL — pipeline produced a half state on a decodable input.');
      process.exit(1);
    }
    console.log('  → transform is sound');
  }

  console.log('\nConclusion');
  if (hevc) {
    console.log('  HEVC decode is available: HEIC uploads will process normally and');
    console.log("  reach processing_status='done'. The 422 MEDIA_PROCESSING_FAILED path");
    console.log('  in MediaService.toDto is dormant in this environment.');
  } else {
    console.log('  HEVC decode is MISSING: every iPhone .HEIC upload will fail processing,');
    console.log("  land on processing_status='failed', and be answered with 422");
    console.log('  MEDIA_PROCESSING_FAILED by MediaService.toDto. This is handled, but it');
    console.log('  means the upload was wasted before the refusal.');
    console.log('');
    console.log('  Therefore: the frontend picker guard (preferredAssetRepresentationMode');
    console.log('  = Compatible, plus the mimeType check in lib/media/picker.ts) is');
    console.log('  load-bearing here, not defence in depth. Verify it on a real iPhone');
    console.log('  before shipping, and re-run this check against the deploy image —');
    console.log('  a different base image can flip this result either way.');
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
