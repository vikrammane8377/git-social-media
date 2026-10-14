import { probe, run, type ClipParams } from "./ffmpeg.js";

/**
 * Overlays the store-badge banner onto a clip as a persistent lower-third. Wan
 * cannot render text reliably, so the "iOS, Android & Web" banner is composited
 * by ffmpeg instead — crisp and identical on every outro. The banner is scaled
 * to ~86% of the frame width and pinned near the bottom for the whole clip; the
 * video is re-encoded to the probed main params so the later concat is seamless,
 * while the spoken-CTA audio is copied through untouched.
 *
 * {@link buildBadgeOverlayArgs} is pure (returns the ffmpeg argv given the probed
 * params); {@link overlayBadge} probes the clip and shells out.
 */

export interface BadgeOverlayArgsOptions {
  /** Absolute path to the clip to overlay onto (the generated outro). */
  videoPath: string;
  /** Absolute path to the single combined badge banner PNG. */
  badgePath: string;
  /** Absolute output path for the branded clip. */
  outPath: string;
  /** Main clip params the output must match (from {@link probe}). */
  params: ClipParams;
}

/**
 * Compose the ffmpeg argv that overlays the badge banner and re-encodes to the
 * probed params. Pure. Audio (the spoken CTA) is copied through when present.
 */
export function buildBadgeOverlayArgs(opts: BadgeOverlayArgsOptions): string[] {
  const { videoPath, badgePath, outPath, params: p } = opts;
  const { width: W, height: H, fps, pixelFormat: pix } = p;
  const bannerW = Math.round(W * 0.86);
  const bottomMargin = Math.round(H * 0.06);

  const chains = [
    `[1:v]scale=${bannerW}:-1[banner]`,
    `[0:v][banner]overlay=x=(W-w)/2:y=H-h-${bottomMargin}[ov]`,
    `[ov]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[v]`,
  ];

  return [
    "-y",
    "-i",
    videoPath,
    "-i",
    badgePath,
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[v]",
    // Carry the spoken-CTA track through unchanged when the clip has one.
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    pix,
    "-r",
    String(fps),
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outPath,
  ];
}

export interface OverlayBadgeOptions {
  /** Absolute path to the clip to overlay onto (the generated outro). */
  videoPath: string;
  /** Absolute path to the single combined badge banner PNG. */
  badgePath: string;
  /** Absolute output path for the branded clip. */
  outPath: string;
}

/** Probe the clip, overlay the badge banner, and re-encode → `outPath`. */
export function overlayBadge(opts: OverlayBadgeOptions): string {
  const params = probe(opts.videoPath);
  run(
    buildBadgeOverlayArgs({
      videoPath: opts.videoPath,
      badgePath: opts.badgePath,
      outPath: opts.outPath,
      params,
    }),
  );
  return opts.outPath;
}

export interface BadgesOverlayArgsOptions {
  /** Absolute path to the clip to overlay onto (the captioned main clip). */
  videoPath: string;
  /** Absolute path to the App Store badge PNG. */
  appStorePath: string;
  /** Absolute path to the Play Store badge PNG. */
  playStorePath: string;
  /** Absolute output path for the branded clip. */
  outPath: string;
  /**
   * The badges appear only from this timestamp (seconds) to the end — the spoken
   * CTA tail. Gated with `enable='gte(t,startSeconds)'`.
   */
  startSeconds: number;
  /** Main clip params the output must match (from {@link probe}). */
  params: ClipParams;
}

/**
 * Compose the ffmpeg argv that overlays the TWO store badges side-by-side,
 * centred near the bottom, and gated to the CTA tail (`enable='gte(t,start)'`),
 * then re-encodes to the probed params. Pure. Audio is copied through when
 * present. Both badges are scaled to a shared height so they line up; they are
 * stacked into one strip (`hstack`) which is then centred horizontally.
 *
 * The strip animates in on the tail rather than popping as a static paste: it
 * slides up from just below the frame with an ease-out curve over
 * {@link ENTER_SECONDS}. The slide is driven entirely by a time-based `overlay`
 * y-expression (quoted so its commas survive filtergraph parsing), evaluated per
 * output frame — so the badge inputs stay single stills (no `loop`, which would
 * make an unbounded secondary stream that never ends on the main clip's EOF).
 */
const ENTER_SECONDS = 0.6;

export function buildBadgesOverlayArgs(opts: BadgesOverlayArgsOptions): string[] {
  const { videoPath, appStorePath, playStorePath, outPath, startSeconds, params: p } = opts;
  const { width: W, height: H, fps, pixelFormat: pix } = p;
  // Shared badge height (~8% of frame) and a small gap between the two badges.
  const badgeH = Math.round(H * 0.08);
  const gap = Math.round(W * 0.03);
  const bottomMargin = Math.round(H * 0.06);
  const start = Math.max(0, startSeconds);
  const enter = ENTER_SECONDS;

  // Ease-out slide: at t=start the strip sits one (strip-height + margin) below
  // its resting spot (fully off-frame); by t=start+enter it rests at
  // H-h-bottomMargin. progress p∈[0,1]; offset = travel·(1-p)² (quadratic ease).
  const yExpr =
    `(H-h-${bottomMargin})+(h+${bottomMargin})*` +
    `pow(1-min(1,max(0,(t-${start})/${enter})),2)`;

  const chains = [
    // Scale each badge to the shared height; pad the first with a transparent
    // right-hand gap so the pair isn't flush when stacked.
    `[1:v]scale=-1:${badgeH}:flags=lanczos,pad=iw+${gap}:ih:0:0:color=black@0[appbadge]`,
    `[2:v]scale=-1:${badgeH}:flags=lanczos[playbadge]`,
    `[appbadge][playbadge]hstack=inputs=2[badges]`,
    `[0:v][badges]overlay=x=(W-w)/2:y='${yExpr}':enable='gte(t,${start})'[ov]`,
    `[ov]fps=${fps},scale=${W}:${H},setsar=1,format=${pix}[v]`,
  ];

  return [
    "-y",
    "-i",
    videoPath,
    "-i",
    appStorePath,
    "-i",
    playStorePath,
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[v]",
    // Carry the spoken-CTA track through unchanged when the clip has one.
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-pix_fmt",
    pix,
    "-r",
    String(fps),
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outPath,
  ];
}

export interface OverlayBadgesOptions {
  /** Absolute path to the clip to overlay onto (the captioned main clip). */
  videoPath: string;
  /** Absolute path to the App Store badge PNG. */
  appStorePath: string;
  /** Absolute path to the Play Store badge PNG. */
  playStorePath: string;
  /** Absolute output path for the branded clip. */
  outPath: string;
  /** The badges appear only from this timestamp (seconds) to the end. */
  startSeconds: number;
}

/** Probe the clip, overlay the two store badges on the tail, re-encode → `outPath`. */
export function overlayBadges(opts: OverlayBadgesOptions): string {
  const params = probe(opts.videoPath);
  run(
    buildBadgesOverlayArgs({
      videoPath: opts.videoPath,
      appStorePath: opts.appStorePath,
      playStorePath: opts.playStorePath,
      outPath: opts.outPath,
      startSeconds: opts.startSeconds,
      params,
    }),
  );
  return opts.outPath;
}
