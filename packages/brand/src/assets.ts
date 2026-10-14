import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolves the owner-supplied brand PNGs (and the title font) under
 * `assets/brand/`. Every layer is OPTIONAL: a missing asset is reported absent
 * and the compositors simply skip that layer, matching the codebase's non-fatal
 * image/thumbnail pattern. The owner drops these files in; nothing here downloads
 * or generates them.
 *
 * The owner supplied real filenames that differ from the code's original
 * placeholders, so each slot resolves the real name first and falls back to the
 * old placeholder as an alias (non-breaking):
 *   App Logo.png                  BixLearn wordmark + mascot (thumbnail logo)
 *                                 — alias bix-logo.png
 *   app_icon.png                  hi-res 3D Bix hero (Wan outro reference;
 *                                 end-card centre)
 *   App store playstore asset.png single combined store-badge banner
 *                                 (composited as one overlay, not two badges)
 *   appstore.png / playstore.png  the old two-badge pair, used only when the
 *                                 combined banner is absent
 *   screenshots/NN-*.png          app UI stills (optional extra refs), sorted
 *   fonts/title.ttf               brand bold font for drawtext; falls back to a
 *                                 system bold TTF (e.g. DejaVu Sans Bold).
 *
 * Filenames contain spaces — fine: everything shells out via `execFileSync`
 * (argv, no shell quoting).
 */

export interface BrandAssets {
  /** Absolute path to the BixLearn logo PNG (wordmark + mascot), when present. */
  logoPath?: string;
  /** Absolute path to the hi-res 3D Bix hero icon PNG, when present. */
  iconPath?: string;
  /** Absolute path to the single combined store-badge banner PNG, when present. */
  badgePath?: string;
  /** Absolute path to the App Store badge PNG (fallback when no combined banner). */
  appStorePath?: string;
  /** Absolute path to the Play Store badge PNG (fallback when no combined banner). */
  playStorePath?: string;
  /** Sorted absolute paths to the app UI screenshot stills (optional extra refs). */
  screenshots: string[];
  /**
   * Absolute path to a bold TTF for `drawtext`: the brand font when present,
   * else the first system fallback found. Undefined only when no font exists at
   * all, in which case title text is skipped (non-fatal).
   */
  fontPath?: string;
}

/**
 * Common locations for a free bold TTF, tried in order when the brand font is
 * absent. DejaVu Sans Bold ships via `fonts-dejavu-core` on the VM and with
 * Homebrew's ffmpeg font set on macOS; the others are best-effort fallbacks.
 */
const FALLBACK_FONTS: readonly string[] = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/opt/homebrew/share/fonts/DejaVuSans-Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
];

/**
 * The two store-badge PNGs live under `screenshots/` (where the owner dropped
 * them) but are NOT app-UI stills: they must never be enumerated as feature
 * screenshots or passed to Wan as references. Matched case-insensitively.
 */
const BADGE_SCREENSHOT_NAMES: ReadonlySet<string> = new Set([
  "app store.png",
  "play store.png",
]);

/** First existing path from a candidate list, or undefined when none exist. */
function firstExisting(paths: readonly string[]): string | undefined {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Sorted absolute paths of every app-UI `.png` directly under `dir` (empty when
 * absent). The store-badge PNGs ({@link BADGE_SCREENSHOT_NAMES}) are excluded so
 * they are never treated as feature screenshots or Wan references.
 */
function listScreenshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.toLowerCase().endsWith(".png"))
    .filter((n) => !BADGE_SCREENSHOT_NAMES.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => resolve(dir, n));
}

/**
 * Resolve the brand assets under `<root>/assets/brand`, reporting only the files
 * that actually exist. Each role resolves the owner's real filename first, then
 * the old placeholder alias. The title font prefers the brand `fonts/title.ttf`,
 * then a bundled/system fallback.
 */
export function loadBrandAssets(root: string): BrandAssets {
  const base = resolve(root, "assets", "brand");
  /** First of `names` that exists under the brand dir, else undefined. */
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const full = resolve(base, name);
      if (existsSync(full)) return full;
    }
    return undefined;
  };
  const screenshotsDir = resolve(base, "screenshots");
  /** First of `names` that exists under the screenshots dir, else undefined. */
  const pickScreenshot = (...names: string[]): string | undefined => {
    for (const name of names) {
      const full = resolve(screenshotsDir, name);
      if (existsSync(full)) return full;
    }
    return undefined;
  };

  const brandFont = resolve(base, "fonts", "title.ttf");
  const fontPath = existsSync(brandFont) ? brandFont : firstExisting(FALLBACK_FONTS);

  const assets: BrandAssets = { screenshots: listScreenshots(resolve(base, "screenshots")) };
  const logo = pick("App Logo.png", "bix-logo.png");
  if (logo) assets.logoPath = logo;
  const icon = pick("app_icon.png");
  if (icon) assets.iconPath = icon;
  const badge = pick("App store playstore asset.png");
  if (badge) assets.badgePath = badge;
  // The owner's two separate badges live under screenshots/ ("APP STORE.png",
  // "PLAY STORE.png"); fall back to the old brand-root placeholders as aliases.
  const appStore = pickScreenshot("APP STORE.png") ?? pick("appstore.png");
  if (appStore) assets.appStorePath = appStore;
  const playStore = pickScreenshot("PLAY STORE.png") ?? pick("playstore.png");
  if (playStore) assets.playStorePath = playStore;
  if (fontPath) assets.fontPath = fontPath;
  return assets;
}
