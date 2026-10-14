import type { BrandAssets } from "./assets.js";
import { run } from "./ffmpeg.js";
import { escapeDrawText, wrapTitle } from "./text.js";

/**
 * Builds the designed vertical (9:16) YouTube thumbnail: the base still scaled &
 * cropped to fill 1080x1920, a bottom scrim for text legibility, the wrapped
 * title, the BixLearn logo at the top, and the store badges along the bottom.
 * When the owner's single combined badge banner is present it is overlaid as one
 * centred lower banner; otherwise the legacy App Store / Play Store pair falls
 * back to a two-badge row. Everything is one ffmpeg `filter_complex` producing a
 * single PNG frame. Every brand layer is OPTIONAL: a missing logo/badge/font is
 * simply left out, so the thumbnail still renders from whatever assets exist.
 *
 * {@link buildThumbnailArgs} is pure (returns the ffmpeg argv) so the layering
 * can be unit-tested without ffmpeg; {@link composeThumbnail} wraps the title and
 * shells out.
 */

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

export interface ThumbnailArgsOptions {
  /** Absolute path to the base still (the same one Spanish feeds the video). */
  basePath: string;
  /** Absolute output path for the composited PNG. */
  outPath: string;
  width: number;
  height: number;
  /** Pre-wrapped title lines (see {@link wrapTitle}); empty skips the title. */
  titleLines: readonly string[];
  /** Bold TTF for drawtext; when absent the title is skipped. */
  fontPath?: string;
  /** Transparent logo PNG (top). */
  logoPath?: string;
  /** Single combined store-badge banner PNG (bottom); preferred over the pair. */
  badgePath?: string;
  /** App Store badge PNG (bottom row); used only when `badgePath` is absent. */
  appStorePath?: string;
  /** Play Store badge PNG (bottom row); used only when `badgePath` is absent. */
  playStorePath?: string;
}

/**
 * Compose the ffmpeg argv for the thumbnail. Pure: no filesystem or process
 * access, so tests can assert the input list and filter graph directly.
 */
export function buildThumbnailArgs(opts: ThumbnailArgsOptions): string[] {
  const { basePath, outPath, width: W, height: H } = opts;

  // The single combined banner, when present, replaces the two-badge pair.
  const useBanner = opts.badgePath !== undefined;

  // Inputs: base first, then only the brand layers that exist (stable order).
  const inputArgs: string[] = ["-i", basePath];
  let nextIdx = 1;
  let logoIdx: number | undefined;
  let bannerIdx: number | undefined;
  let appIdx: number | undefined;
  let playIdx: number | undefined;
  if (opts.logoPath) {
    logoIdx = nextIdx++;
    inputArgs.push("-i", opts.logoPath);
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

  const chains: string[] = [];

  // 1. Fill 1080x1920 (scale up to cover, then crop the overflow) + square pixels.
  chains.push(
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]`,
  );
  let cur = "bg";

  // 2. Bottom scrim so the title stays legible over any still.
  const scrimH = Math.round(H * 0.38);
  chains.push(
    `[${cur}]drawbox=x=0:y=${H - scrimH}:w=${W}:h=${scrimH}:color=black@0.55:t=fill[scrim]`,
  );
  cur = "scrim";

  // 3. Title (only when a font and text exist).
  if (opts.fontPath && opts.titleLines.length > 0) {
    const fontSize = Math.round(W * 0.075);
    const lineSpacing = Math.round(fontSize * 0.25);
    const titleY = H - scrimH + Math.round(H * 0.04);
    const text = opts.titleLines.map(escapeDrawText).join("\n");
    const font = escapeDrawText(opts.fontPath);
    chains.push(
      `[${cur}]drawtext=fontfile='${font}':text='${text}':fontcolor=white:` +
        `fontsize=${fontSize}:line_spacing=${lineSpacing}:x=(w-text_w)/2:y=${titleY}[titled]`,
    );
    cur = "titled";
  }

  // 4. Logo, centred near the top.
  if (logoIdx !== undefined) {
    const logoW = Math.round(W * 0.32);
    const logoY = Math.round(H * 0.05);
    chains.push(`[${logoIdx}:v]scale=${logoW}:-1[logo]`);
    chains.push(`[${cur}][logo]overlay=x=(W-w)/2:y=${logoY}[logoed]`);
    cur = "logoed";
  }

  // 5. Store badges along the bottom. Prefer the single combined banner (one
  //    centred overlay spanning most of the width); otherwise fall back to the
  //    legacy App Store / Play Store two-badge row.
  if (bannerIdx !== undefined) {
    const bannerW = Math.round(W * 0.72);
    const bottomMargin = Math.round(H * 0.04);
    chains.push(`[${bannerIdx}:v]scale=${bannerW}:-1[banner]`);
    chains.push(`[${cur}][banner]overlay=x=(W-w)/2:y=H-h-${bottomMargin}[badged]`);
    cur = "badged";
  } else {
    const badgeIdxs: number[] = [];
    if (appIdx !== undefined) badgeIdxs.push(appIdx);
    if (playIdx !== undefined) badgeIdxs.push(playIdx);
    if (badgeIdxs.length > 0) {
      const badgeW = Math.round(W * 0.33);
      const gap = Math.round(W * 0.03);
      const total = badgeIdxs.length * badgeW + (badgeIdxs.length - 1) * gap;
      const startX = Math.round((W - total) / 2);
      const bottomMargin = Math.round(H * 0.04);
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

export interface ComposeThumbnailOptions {
  /** Absolute path to the base still. */
  basePath: string;
  /** Absolute output path for the PNG. */
  outPath: string;
  /** The clip's title; wrapped to fit the vertical frame. */
  title: string;
  /** Resolved brand assets (any subset may be present). */
  brand: BrandAssets;
  /** Defaults to 1080x1920. */
  width?: number;
  height?: number;
}

/** Wrap the title and render the designed thumbnail to `outPath` via ffmpeg. */
export function composeThumbnail(opts: ComposeThumbnailOptions): string {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const titleLines = opts.title.trim()
    ? wrapTitle(opts.title, { maxCharsPerLine: 20, maxLines: 3 })
    : [];
  const args = buildThumbnailArgs({
    basePath: opts.basePath,
    outPath: opts.outPath,
    width,
    height,
    titleLines,
    fontPath: opts.brand.fontPath,
    logoPath: opts.brand.logoPath,
    badgePath: opts.brand.badgePath,
    appStorePath: opts.brand.appStorePath,
    playStorePath: opts.brand.playStorePath,
  });
  run(args);
  return opts.outPath;
}
