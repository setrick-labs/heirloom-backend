import { spawn } from 'node:child_process';

import { env } from '../../config/env';

/**
 * Everything MediaProcessingService needs from ffmpeg, kept out of the
 * service so the decisions (planVideoEncode, the argument lists) are plain
 * functions a spec can check without a binary or a bucket.
 *
 * What a processed video ends up as:
 *
 *   - H.264 High / AAC in an MP4, the one pairing every phone and browser
 *     plays. iPhones record HEVC in .mov, which some Android devices and most
 *     desktop browsers won't play at all.
 *   - At most 1080p on the short edge, and capped VBR around 5 Mbps. A phone
 *     records 1080p at 15–20 Mbps and 4K at 40+; nobody can see that
 *     difference on a phone screen, and it decides how long playback waits.
 *   - `faststart`: the index (moov atom) at the front of the file. Without it
 *     a player has to fetch the end of the file before it can show frame one,
 *     and over a slow connection that looks like the video won't play. With
 *     it, playback starts after the first few hundred KB and range requests
 *     fetch the rest as needed. The whole file is never downloaded up front.
 */

/** Long and short edge caps: 1920×1080 in whichever orientation. */
const MAX_LONG_EDGE = 1920;
const MAX_SHORT_EDGE = 1080;
/** Constant quality, with a ceiling so a busy scene can't spike the stream. */
const CRF = 23;
const MAX_BITRATE = '5M';
const BUFFER_SIZE = '10M';
const AUDIO_BITRATE = '128k';
/**
 * An upload already in the target format is remuxed, not re-encoded: the
 * same pixels, the index moved to the front, in a second rather than a
 * minute. Only when its bitrate is no more than this, or the streaming copy
 * would be no lighter than the original.
 */
const MAX_REMUX_BITRATE = 8_000_000;
/** Transfer functions of HDR video: HLG (iPhone default) and PQ. */
const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);

const PROBE_TIMEOUT_MS = 30_000;
const POSTER_TIMEOUT_MS = 60_000;
/** Generous: a 300MB 4K upload on a small instance takes minutes. */
const ENCODE_TIMEOUT_MS = 20 * 60_000;

export interface VideoProbe {
  /** Container format names, as ffprobe reports them ("mov,mp4,m4a,..."). */
  formatName: string;
  durationSeconds: number;
  /** Overall bitrate in bits/s, 0 when unknown. */
  bitRate: number;
  videoCodec: string;
  /** e.g. "High", "Main", "High 10" — the last of which plays almost nowhere. */
  videoProfile: string;
  pixelFormat: string;
  colorTransfer: string;
  /** As displayed, after rotation metadata — not as stored. */
  width: number;
  height: number;
  /** Null when the file has no audio track. */
  audioCodec: string | null;
}

export type VideoEncodePlan =
  | { mode: 'remux' }
  | { mode: 'transcode'; width: number; height: number; hdr: boolean };

/** Runs a binary to completion, resolving its stdout. Rejects on non-zero exit or timeout. */
function run(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    // Only the tail — ffmpeg is chatty and the end is where the error is.
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString());
      else reject(new Error(`${binary} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

/** Rotation from either the display-matrix side data (current) or the legacy `rotate` tag. */
function rotationOf(stream: {
  side_data_list?: { rotation?: number | string }[];
  tags?: { rotate?: string };
}): number {
  const fromSideData = stream.side_data_list?.find(
    (entry) => entry.rotation !== undefined,
  )?.rotation;
  const raw = fromSideData ?? stream.tags?.rotate ?? 0;
  const degrees = Number(raw);
  return Number.isFinite(degrees) ? degrees : 0;
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  const output = await run(
    env.FFPROBE_PATH,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ],
    PROBE_TIMEOUT_MS,
  );
  const parsed = JSON.parse(output) as {
    format?: { format_name?: string; duration?: string; bit_rate?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      profile?: string;
      pix_fmt?: string;
      color_transfer?: string;
      width?: number;
      height?: number;
      side_data_list?: { rotation?: number | string }[];
      tags?: { rotate?: string };
    }[];
  };

  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) {
    throw new Error('No video stream with a known size');
  }
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  const quarterTurn = Math.abs(rotationOf(video)) % 180 === 90;

  return {
    formatName: parsed.format?.format_name ?? '',
    durationSeconds: Number(parsed.format?.duration) || 0,
    bitRate: Number(parsed.format?.bit_rate) || 0,
    videoCodec: video.codec_name ?? '',
    videoProfile: video.profile ?? '',
    pixelFormat: video.pix_fmt ?? '',
    colorTransfer: video.color_transfer ?? '',
    width: quarterTurn ? video.height : video.width,
    height: quarterTurn ? video.width : video.height,
    audioCodec: audio?.codec_name ?? null,
  };
}

/** Even dimensions within the 1080p caps, aspect ratio kept. H.264 needs both even. */
export function fitWithinCaps(width: number, height: number) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, MAX_LONG_EDGE / long, MAX_SHORT_EDGE / short);
  const even = (value: number) =>
    Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Remux when the upload already is what a transcode would produce; otherwise transcode. Pure. */
export function planVideoEncode(probe: VideoProbe): VideoEncodePlan {
  const hdr = HDR_TRANSFERS.has(probe.colorTransfer);
  const target = fitWithinCaps(probe.width, probe.height);
  const alreadyFits =
    /(^|,)(mp4|mov)(,|$)/.test(probe.formatName) &&
    probe.videoCodec === 'h264' &&
    probe.pixelFormat === 'yuv420p' &&
    !/10|422|444/.test(probe.videoProfile) &&
    (probe.audioCodec === null || probe.audioCodec === 'aac') &&
    !hdr &&
    target.width === probe.width &&
    target.height === probe.height &&
    probe.bitRate > 0 &&
    probe.bitRate <= MAX_REMUX_BITRATE;

  return alreadyFits
    ? { mode: 'remux' }
    : { mode: 'transcode', ...target, hdr };
}

/**
 * HDR → SDR. Without tone mapping an iPhone's HLG clip comes out grey and
 * flat once squeezed into 8-bit BT.709. Needs ffmpeg built with zimg; when it
 * isn't, the video is still converted, just less faithfully.
 */
const TONEMAP_FILTER =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,' +
  'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

function videoFilter(
  width: number,
  height: number,
  hdr: boolean,
  canTonemap: boolean,
) {
  const filters = [`scale=${width}:${height}`];
  if (hdr && canTonemap) filters.push(TONEMAP_FILTER);
  filters.push('format=yuv420p');
  return filters.join(',');
}

export function encodeArgs(
  input: string,
  output: string,
  plan: VideoEncodePlan,
  canTonemap: boolean,
): string[] {
  // First video track, and the first audio track if there is one — phones
  // add metadata and depth tracks that some players choke on.
  const common = [
    '-y',
    '-v',
    'error',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
  ];
  const streaming = ['-movflags', '+faststart', '-f', 'mp4', output];

  if (plan.mode === 'remux') return [...common, '-c', 'copy', ...streaming];

  return [
    ...common,
    '-vf',
    videoFilter(plan.width, plan.height, plan.hdr, canTonemap),
    '-c:v',
    'libx264',
    // veryfast: about half the encode time of `medium` for a few percent
    // more bytes — the right side of that trade on a shared API instance.
    '-preset',
    'veryfast',
    '-crf',
    String(CRF),
    '-maxrate',
    MAX_BITRATE,
    '-bufsize',
    BUFFER_SIZE,
    '-profile:v',
    'high',
    '-level:v',
    '4.1',
    // 120/240fps slow-motion has no business in a stream for a phone screen.
    '-fpsmax',
    '60',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ac',
    '2',
    ...streaming,
  ];
}

export function encodeVideo(
  input: string,
  output: string,
  plan: VideoEncodePlan,
  canTonemap: boolean,
): Promise<string> {
  return run(
    env.FFMPEG_PATH,
    encodeArgs(input, output, plan, canTonemap),
    ENCODE_TIMEOUT_MS,
  );
}

/**
 * One frame as a PNG, for sharp to turn into the poster and thumb. Taken a
 * little way in rather than at 0 — the very first frame of a phone clip is
 * often black, or a blur from the phone still being raised.
 */
export function extractPosterFrame(
  input: string,
  output: string,
  probe: VideoProbe,
  canTonemap: boolean,
): Promise<string> {
  const at = Math.min(1, probe.durationSeconds * 0.25);
  const hdr = HDR_TRANSFERS.has(probe.colorTransfer);
  return run(
    env.FFMPEG_PATH,
    [
      '-y',
      '-v',
      'error',
      // Before -i: a fast keyframe seek instead of decoding up to it.
      '-ss',
      at.toFixed(2),
      '-i',
      input,
      '-frames:v',
      '1',
      ...(hdr && canTonemap ? ['-vf', `${TONEMAP_FILTER},format=rgb24`] : []),
      output,
    ],
    POSTER_TIMEOUT_MS,
  );
}

let tonemapSupport: Promise<boolean> | null = null;

/** Whether this ffmpeg has the zscale filter tone mapping needs. Asked once per process. */
export function canTonemap(): Promise<boolean> {
  tonemapSupport ??= run(
    env.FFMPEG_PATH,
    ['-hide_banner', '-filters'],
    PROBE_TIMEOUT_MS,
  )
    .then((output) => /\szscale\s/.test(output))
    .catch(() => false);
  return tonemapSupport;
}
