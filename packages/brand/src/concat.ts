import { execFileSync } from "node:child_process";
import { ffprobePath, probe, run, type ClipParams } from "./ffmpeg.js";

/**
 * Concatenates two real MP4s into one seamless clip (the captioned main clip
 * followed by the branded animated outro). Both segments are normalised to the
 * probed MAIN params — fps, scale, setsar, pixel format and, when the main clip
 * has audio, a matched audio track — because a mismatched concat is the classic
 * cause of a stutter or audio glitch at the join. When one segment lacks an
 * audio stream a matched silent track is synthesised for it so the concat keeps
 * exactly one audio stream throughout; when the main clip itself has no audio
 * the output is video-only. This generalises the still-based concat in
 * {@link appendOutro} to two genuine clips.
 *
 * {@link buildConcatArgs} is pure (returns the ffmpeg argv given the probed
 * params and each segment's audio presence/duration); {@link concatClips} probes
 * both clips and shells out.
 */

export interface ConcatArgsOptions {
  /** Absolute path to the first clip (the captioned main clip). */
  firstPath: string;
  /** Absolute path to the second clip (the branded outro). */
  secondPath: string;
  /** Absolute output path for the concatenated clip. */
  outPath: string;
  /** Target params both segments are normalised to (the probed MAIN clip). */
  params: ClipParams;
  /** Whether the first clip carries an audio stream. */
  firstHasAudio: boolean;
  /** Whether the second clip carries an audio stream. */
  secondHasAudio: boolean;
  /** First clip duration (seconds); required only when it needs a silent track. */
  firstDurationSeconds?: number;
  /** Second clip duration (seconds); required only when it needs a silent track. */
  secondDurationSeconds?: number;
}

/** ffmpeg channel-layout name for a channel count (mono/stereo, else stereo). */
function channelLayout(channels: number | undefined): string {
  return channels === 1 ? "mono" : "stereo";
}

/**
 * Compose the ffmpeg argv that normalises and concatenates the two clips. Pure.
 * When the main params carry audio, each segment contributes an audio branch:
 * its own track (resampled/reformatted) when present, else a matched silent
 * `anullsrc` bounded to that segment's duration. When the main params carry no
 * audio the output is video-only.
 */
export function buildConcatArgs(opts: ConcatArgsOptions): string[] {
  const { firstPath, secondPath, outPath, params: p } = opts;
  const { width: W, height: H, fps, pixelFormat: pix } = p;
  const wantAudio = p.sampleRate !== undefined && p.channels !== undefined;
  const layout = channelLayout(p.channels);

  const inputArgs: string[] = ["-i", firstPath, "-i", secondPath];

  // Video normalisation is identical for both segments.
  const chains: string[] = [
    `[0:v]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[v0]`,
    `[1:v]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[v1]`,
  ];

  const encode: string[] = ["-c:v", "libx264", "-pix_fmt", pix, "-r", String(fps)];

  if (!wantAudio) {
    chains.push(`[v0][v1]concat=n=2:v=1:a=0[v]`);
    return [
      "-y",
      ...inputArgs,
      "-filter_complex",
      chains.join(";"),
      "-map",
      "[v]",
      ...encode,
      "-movflags",
      "+faststart",
      outPath,
    ];
  }

  // Each segment needs one audio branch. A segment with its own audio is
  // resampled/reformatted to the target; a silent one gets a matched anullsrc
  // bounded to its duration (so the concat's audio ends with the video).
  let nextIdx = 2;
  const audioBranch = (
    clipIdx: number,
    hasAudio: boolean,
    durationSeconds: number | undefined,
    label: string,
  ): void => {
    if (hasAudio) {
      chains.push(
        `[${clipIdx}:a]aresample=${p.sampleRate},aformat=sample_fmts=fltp:channel_layouts=${layout}[${label}]`,
      );
      return;
    }
    const dur = durationSeconds ?? 0;
    inputArgs.push(
      "-f",
      "lavfi",
      "-t",
      String(dur),
      "-i",
      `anullsrc=channel_layout=${layout}:sample_rate=${p.sampleRate}`,
    );
    const silentIdx = nextIdx++;
    chains.push(
      `[${silentIdx}:a]aformat=sample_fmts=fltp:channel_layouts=${layout}[${label}]`,
    );
  };

  audioBranch(0, opts.firstHasAudio, opts.firstDurationSeconds, "a0");
  audioBranch(1, opts.secondHasAudio, opts.secondDurationSeconds, "a1");
  chains.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`);
  encode.push("-c:a", "aac", "-ar", String(p.sampleRate), "-ac", String(p.channels));

  return [
    "-y",
    ...inputArgs,
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...encode,
    "-movflags",
    "+faststart",
    outPath,
  ];
}

export interface ConcatClipsOptions {
  /** Absolute path to the first clip (the captioned main clip). */
  firstPath: string;
  /** Absolute path to the second clip (the branded outro). */
  secondPath: string;
  /** Absolute output path for the concatenated clip. */
  outPath: string;
}

/** Read a clip's duration in seconds via ffprobe, or undefined when unknown. */
function probeDurationSeconds(videoPath: string): number | undefined {
  try {
    const out = execFileSync(
      ffprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", videoPath],
      { encoding: "utf8" },
    );
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe both clips (the first for the target params, each for audio presence +
 * duration) and concatenate them into `outPath`.
 */
export function concatClips(opts: ConcatClipsOptions): string {
  const firstParams = probe(opts.firstPath);
  const secondParams = probe(opts.secondPath);
  run(
    buildConcatArgs({
      firstPath: opts.firstPath,
      secondPath: opts.secondPath,
      outPath: opts.outPath,
      params: firstParams,
      firstHasAudio: firstParams.sampleRate !== undefined && firstParams.channels !== undefined,
      secondHasAudio: secondParams.sampleRate !== undefined && secondParams.channels !== undefined,
      firstDurationSeconds: probeDurationSeconds(opts.firstPath),
      secondDurationSeconds: probeDurationSeconds(opts.secondPath),
    }),
  );
  return opts.outPath;
}
