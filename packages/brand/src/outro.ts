import { probe, run, type ClipParams } from "./ffmpeg.js";

/**
 * Appends the branded end-card to a finished clip. The end-card still is turned
 * into a short clip whose video AND audio params are matched to the probed main
 * clip (resolution, fps, pixel format, sample rate, channels), then the two are
 * concatenated. Matching the params is what keeps playback from stuttering at the
 * join — a mismatched concat is the classic failure here.
 *
 * {@link buildOutroArgs} is pure (returns the ffmpeg argv given the probed
 * params); {@link appendOutro} probes the clip and shells out.
 */

export interface OutroArgsOptions {
  /** Absolute path to the finished (captioned) main clip. */
  videoPath: string;
  /** Absolute path to the end-card still PNG. */
  endCardPath: string;
  /** Absolute output path for the concatenated clip. */
  outPath: string;
  /** End-card duration in seconds (~2.5). */
  durationSeconds: number;
  /** Main clip params the end-card clip must match (from {@link probe}). */
  params: ClipParams;
}

/** ffmpeg channel-layout name for a channel count (mono/stereo, else stereo). */
function channelLayout(channels: number | undefined): string {
  return channels === 1 ? "mono" : "stereo";
}

/**
 * Compose the ffmpeg argv that builds the end-card clip and concatenates it after
 * the main clip. Pure. When the main clip has audio (sampleRate+channels probed),
 * a matched silent track is generated for the end-card so the concat keeps one
 * audio stream throughout; otherwise the output is video-only.
 */
export function buildOutroArgs(opts: OutroArgsOptions): string[] {
  const { videoPath, endCardPath, outPath, durationSeconds: dur, params: p } = opts;
  const { width: W, height: H, fps, pixelFormat: pix } = p;
  const hasAudio = p.sampleRate !== undefined && p.channels !== undefined;

  const inputArgs: string[] = [
    "-i",
    videoPath,
    "-loop",
    "1",
    "-t",
    String(dur),
    "-i",
    endCardPath,
  ];
  if (hasAudio) {
    inputArgs.push(
      "-f",
      "lavfi",
      "-t",
      String(dur),
      "-i",
      `anullsrc=channel_layout=${channelLayout(p.channels)}:sample_rate=${p.sampleRate}`,
    );
  }

  // Normalise both video segments to identical params so concat is seamless.
  const chains: string[] = [
    `[0:v]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[mv]`,
    `[1:v]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[ec]`,
  ];

  const encode: string[] = ["-c:v", "libx264", "-pix_fmt", pix, "-r", String(fps)];
  let mapArgs: string[];

  if (hasAudio) {
    const layout = channelLayout(p.channels);
    chains.push(
      `[0:a]aresample=${p.sampleRate},aformat=sample_fmts=fltp:channel_layouts=${layout}[a0]`,
      `[2:a]aformat=sample_fmts=fltp:channel_layouts=${layout}[a1]`,
      `[mv][a0][ec][a1]concat=n=2:v=1:a=1[v][a]`,
    );
    mapArgs = ["-map", "[v]", "-map", "[a]"];
    encode.push("-c:a", "aac", "-ar", String(p.sampleRate), "-ac", String(p.channels));
  } else {
    chains.push(`[mv][ec]concat=n=2:v=1:a=0[v]`);
    mapArgs = ["-map", "[v]"];
  }

  return [
    "-y",
    ...inputArgs,
    "-filter_complex",
    chains.join(";"),
    ...mapArgs,
    ...encode,
    "-movflags",
    "+faststart",
    outPath,
  ];
}

export interface AppendOutroOptions {
  /** Absolute path to the finished (captioned) main clip. */
  videoPath: string;
  /** Absolute path to the end-card still PNG. */
  endCardPath: string;
  /** Absolute output path for the concatenated clip. */
  outPath: string;
  /** End-card duration in seconds (~2.5). */
  durationSeconds: number;
}

/** Probe the main clip, build the end-card clip, and concat → `outPath`. */
export function appendOutro(opts: AppendOutroOptions): string {
  const params = probe(opts.videoPath);
  run(
    buildOutroArgs({
      videoPath: opts.videoPath,
      endCardPath: opts.endCardPath,
      outPath: opts.outPath,
      durationSeconds: opts.durationSeconds,
      params,
    }),
  );
  return opts.outPath;
}
