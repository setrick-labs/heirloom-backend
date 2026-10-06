import {
  encodeArgs,
  fitWithinCaps,
  planVideoEncode,
  type VideoProbe,
} from './video-transcode';

/** A clip that already is exactly what a transcode would produce. */
const streamable: VideoProbe = {
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSeconds: 12.4,
  bitRate: 4_000_000,
  videoCodec: 'h264',
  videoProfile: 'High',
  pixelFormat: 'yuv420p',
  colorTransfer: 'bt709',
  width: 1080,
  height: 1920,
  audioCodec: 'aac',
};

describe('fitWithinCaps', () => {
  it.each([
    [3840, 2160, 1920, 1080],
    [2160, 3840, 1080, 1920],
    [1920, 1080, 1920, 1080],
    [1280, 720, 1280, 720],
    // Ultra-wide: the long edge is the binding cap.
    [3840, 1080, 1920, 540],
    // Odd source sizes come out even — libx264 refuses odd dimensions.
    [1281, 721, 1282, 722],
  ])('%ix%i → %ix%i', (width, height, expectedWidth, expectedHeight) => {
    expect(fitWithinCaps(width, height)).toEqual({
      width: expectedWidth,
      height: expectedHeight,
    });
  });
});

describe('planVideoEncode', () => {
  it('remuxes a clip that is already streamable H.264/AAC within the caps', () => {
    expect(planVideoEncode(streamable)).toEqual({ mode: 'remux' });
  });

  it('remuxes a silent clip', () => {
    expect(planVideoEncode({ ...streamable, audioCodec: null })).toEqual({
      mode: 'remux',
    });
  });

  it.each<[string, Partial<VideoProbe>]>([
    ['HEVC, as an iPhone records', { videoCodec: 'hevc' }],
    ['a WebM container', { formatName: 'matroska,webm', videoCodec: 'vp9' }],
    ['10-bit H.264', { videoProfile: 'High 10', pixelFormat: 'yuv420p10le' }],
    ['non-AAC audio', { audioCodec: 'opus' }],
    ['a 4K frame', { width: 2160, height: 3840 }],
    ['a bitrate past the remux ceiling', { bitRate: 20_000_000 }],
    ['an unknown bitrate', { bitRate: 0 }],
  ])('transcodes %s', (_label, change) => {
    expect(planVideoEncode({ ...streamable, ...change }).mode).toBe(
      'transcode',
    );
  });

  it('transcodes and flags HDR (HLG) video for tone mapping', () => {
    expect(
      planVideoEncode({
        ...streamable,
        videoCodec: 'hevc',
        colorTransfer: 'arib-std-b67',
        pixelFormat: 'yuv420p10le',
      }),
    ).toEqual({ mode: 'transcode', width: 1080, height: 1920, hdr: true });
  });

  it('scales a 4K portrait clip to 1080p', () => {
    expect(
      planVideoEncode({
        ...streamable,
        videoCodec: 'hevc',
        width: 2160,
        height: 3840,
      }),
    ).toEqual({ mode: 'transcode', width: 1080, height: 1920, hdr: false });
  });
});

describe('encodeArgs', () => {
  it('always writes a faststart MP4, so playback can begin before the download ends', () => {
    for (const plan of [
      { mode: 'remux' as const },
      { mode: 'transcode' as const, width: 1280, height: 720, hdr: false },
    ]) {
      const args = encodeArgs('in', 'out.mp4', plan, true);
      expect(args.join(' ')).toContain('-movflags +faststart');
      expect(args.at(-1)).toBe('out.mp4');
    }
  });

  it('copies streams when remuxing', () => {
    expect(
      encodeArgs('in', 'out', { mode: 'remux' }, true).join(' '),
    ).toContain('-c copy');
  });

  it('tone maps HDR only when the filter is available', () => {
    const plan = {
      mode: 'transcode' as const,
      width: 1080,
      height: 1920,
      hdr: true,
    };
    const filterOf = (args: string[]) => args[args.indexOf('-vf') + 1];
    expect(filterOf(encodeArgs('in', 'out', plan, true))).toContain('tonemap');
    expect(filterOf(encodeArgs('in', 'out', plan, false))).not.toContain(
      'tonemap',
    );
    expect(filterOf(encodeArgs('in', 'out', plan, false))).toBe(
      'scale=1080:1920,format=yuv420p',
    );
  });
});
