import type { BrandAssets } from "./assets.js";
import { run } from "./ffmpeg.js";
import { escapeDrawText } from "./text.js";

/**
 * Builds the branded end-card still (1080x1920): a brand gradient background, the
 * Bix hero large and centred (the hi-res 3D icon when present, else the logo), a
 * "Download Bix Learn" headline, and the store badges along the bottom (the
 * single combined banner when present, else the legacy App Store / Play Store
 * pair). This still is later turned into a short clip by {@link appendOutro} as a
 * non-fatal fallback when the animated outro fails. Like the thumbnail, every
 * brand layer is OPTIONAL; a missing hero/badge/font is simply omitted.
 *
 * {@link buildEndCardArgs} is pure (returns ffmpeg argv); {@link composeEndCard}
 * shells out.
 */

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_HEADLINE = "Download Bix Learn";
/** Brand gradient (deep indigo → near-black), used when no override is given. */
const DEFAULT_BG_START = "0x12264a";
const DEFAULT_BG_END = "0x080f1d";

export interface EndCardArgsOptions {
  /** Absolute output path for the composited PNG. */
  outPath: string;
  width: number;
  height: number;
  /** Call-to-action headline; empty skips the text. */
  headline: string;
  /** Bold TTF for drawtext; when absent the headline is skipped. */
  fontPath?: string;
  /** Hi-res 3D Bix hero icon PNG (centre); preferred over the logo. */
  iconPath?: string;
  /** Transparent logo PNG (centre); used when no icon is present. */
  logoPath?: string;
  /** Single combined store-badge banner PNG (bottom); preferred over the pair. */
  badgePath?: string;
  /** App Store badge PNG (bottom row); used only when `badgePath` is absent. */
  appStorePath?: string;
  /** Play Store badge PNG (bottom row); used only when `badgePath` is absent. */
  playStorePath?: string;
  /** Gradient top-left colour (ffmpeg `0xRRGGBB`). */
  bgColorStart?: string;
  /** Gradient bottom-right colour (ffmpeg `0xRRGGBB`). */
  bgColorEnd?: string;
}

/**
 * Compose the ffmpeg argv for the end-card still. Pure: the background is an
 * `lavfi` gradient source (input 0), then any brand layers that exist.
 */
export function buildEndCardArgs(opts: EndCardArgsOptions): string[] {
  const { outPath, width: W, height: H } = opts;
  const c0 = opts.bgColorStart ?? DEFAULT_BG_START;
  const c1 = opts.bgColorEnd ?? DEFAULT_BG_END;

  // Input 0 is a generated diagonal gradient; brand PNGs follow in stable order.
  const inputArgs: string[] = [
    "-f",
    "lavfi",
    "-i",
    `gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${W}:y1=${H}`,
  ];
  let nextIdx = 1;
  // Central hero: the hi-res 3D icon when present, else the logo wordmark.
  const heroPath = opts.iconPath ?? opts.logoPath;
  const useBanner = opts.badgePath !== undefined;
  let heroIdx: number | undefined;
  let bannerIdx: number | undefined;
  let appIdx: number | undefined;
  let playIdx: number | undefined;
  if (heroPath) {
    heroIdx = nextIdx++;
    inputArgs.push("-i", heroPath);
  }
  if (useBanner) {
    bannerIdx = nextIdx++;
    inputArgs.push("-i", opts.badgePath as string);
  } else {
    if (opts.appStorePath) {
      appIdx = nextIdx++;
      inputArgs.push("-i", opts.appStorePath);
    }
    if (opts.playStorePath) {
      playIdx = nextIdx++;
      inputArgs.push("-i", opts.playStorePath);
    }
  }

  const chains: string[] = [`[0:v]setsar=1[bg]`];
  let cur = "bg";

  // Hero (icon or logo), large and centred in the upper half.
  if (heroIdx !== undefined) {
    const heroW = Math.round(W * 0.55);
    const heroY = Math.round(H * 0.24);
    chains.push(`[${heroIdx}:v]scale=${heroW}:-1[hero]`);
    chains.push(`[${cur}][hero]overlay=x=(W-w)/2:y=${heroY}[heroed]`);
    cur = "heroed";
  }

  // Headline, centred below the logo.
  if (opts.fontPath && opts.headline.trim()) {
    const fontSize = Math.round(W * 0.062);
    const headlineY = Math.round(H * 0.55);
    const text = escapeDrawText(opts.headline.trim());
    const font = escapeDrawText(opts.fontPath);
    chains.push(
      `[${cur}]drawtext=fontfile='${font}':text='${text}':fontcolor=white:` +
        `fontsize=${fontSize}:x=(w-text_w)/2:y=${headlineY}[headlined]`,
    );
    cur = "headlined";
  }

  // Store badges along the bottom: the single combined banner when present,
  // else the legacy App Store / Play Store two-badge row.
  if (bannerIdx !== undefined) {
    const bannerW = Math.round(W * 0.72);
    const bottomMargin = Math.round(H * 0.08);
    chains.push(`[${bannerIdx}:v]scale=${bannerW}:-1[banner]`);
    chains.push(`[${cur}][banner]overlay=x=(W-w)/2:y=H-h-${bottomMargin}[badged]`);
    cur = "badged";
  } else {
    const badgeIdxs: number[] = [];
    if (appIdx !== undefined) badgeIdxs.push(appIdx);
    if (playIdx !== undefined) badgeIdxs.push(playIdx);
    if (badgeIdxs.length > 0) {
      const badgeW = Math.round(W * 0.34);
      const gap = Math.round(W * 0.03);
      const total = badgeIdxs.length * badgeW + (badgeIdxs.length - 1) * gap;
      const startX = Math.round((W - total) / 2);
      const bottomMargin = Math.round(H * 0.08);
      badgeIdxs.forEach((idx, i) => {
        const x = startX + i * (badgeW + gap);
        chains.push(`[${idx}:v]scale=${badgeW}:-1[badge${i}]`);
        chains.push(`[${cur}][badge${i}]overlay=x=${x}:y=H-h-${bottomMargin}[badged${i}]`);
        cur = `badged${i}`;
      });
    }
  }

  return [
    "-y",
    ...inputArgs,
    "-filter_complex",
    chains.join(";"),
    "-map",
    `[${cur}]`,
    "-frames:v",
    "1",
    outPath,
  ];
}

export interface ComposeEndCardOptions {
  /** Absolute output path for the PNG. */
  outPath: string;
  /** Resolved brand assets (any subset may be present). */
  brand: BrandAssets;
  /** Defaults to "Download Bix Learn". */
  headline?: string;
  /** Defaults to 1080x1920. */
  width?: number;
  height?: number;
}

/** Render the branded end-card still to `outPath` via ffmpeg. */
export function composeEndCard(opts: ComposeEndCardOptions): string {
  const args = buildEndCardArgs({
    outPath: opts.outPath,
    width: opts.width ?? DEFAULT_WIDTH,
    height: opts.height ?? DEFAULT_HEIGHT,
    headline: opts.headline ?? DEFAULT_HEADLINE,
    fontPath: opts.brand.fontPath,
    iconPath: opts.brand.iconPath,
    logoPath: opts.brand.logoPath,
    badgePath: opts.brand.badgePath,
    appStorePath: opts.brand.appStorePath,
    playStorePath: opts.brand.playStorePath,
  });
  run(args);
  return opts.outPath;
}
