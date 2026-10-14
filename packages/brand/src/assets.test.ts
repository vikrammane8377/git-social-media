import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrandAssets } from "./assets.js";

const dirs: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "bix-brand-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadBrandAssets", () => {
  it("reports no logo/icon/badges and no screenshots when the brand dir is empty", () => {
    const root = tempRoot();
    const assets = loadBrandAssets(root);
    expect(assets.logoPath).toBeUndefined();
    expect(assets.iconPath).toBeUndefined();
    expect(assets.badgePath).toBeUndefined();
    expect(assets.appStorePath).toBeUndefined();
    expect(assets.playStorePath).toBeUndefined();
    expect(assets.screenshots).toEqual([]);
    // fontPath may resolve to a system fallback or be undefined; never throws.
  });

  it("resolves the owner's real filenames (logo, icon, combined badge banner)", () => {
    const root = tempRoot();
    const brandDir = join(root, "assets", "brand");
    mkdirSync(brandDir, { recursive: true });
    writeFileSync(join(brandDir, "App Logo.png"), "x");
    writeFileSync(join(brandDir, "app_icon.png"), "x");
    writeFileSync(join(brandDir, "App store playstore asset.png"), "x");

    const assets = loadBrandAssets(root);
    expect(assets.logoPath).toBe(join(brandDir, "App Logo.png"));
    expect(assets.iconPath).toBe(join(brandDir, "app_icon.png"));
    expect(assets.badgePath).toBe(join(brandDir, "App store playstore asset.png"));
  });

  it("falls back to the old placeholder names as aliases (non-breaking)", () => {
    const root = tempRoot();
    const brandDir = join(root, "assets", "brand");
    mkdirSync(brandDir, { recursive: true });
    // Only the old placeholder logo + the two-badge pair exist.
    writeFileSync(join(brandDir, "bix-logo.png"), "x");
    writeFileSync(join(brandDir, "appstore.png"), "x");
    writeFileSync(join(brandDir, "playstore.png"), "x");

    const assets = loadBrandAssets(root);
    expect(assets.logoPath).toBe(join(brandDir, "bix-logo.png"));
    expect(assets.appStorePath).toBe(join(brandDir, "appstore.png"));
    expect(assets.playStorePath).toBe(join(brandDir, "playstore.png"));
    // No combined banner present.
    expect(assets.badgePath).toBeUndefined();
  });

  it("prefers the real logo over the alias when both exist", () => {
    const root = tempRoot();
    const brandDir = join(root, "assets", "brand");
    mkdirSync(brandDir, { recursive: true });
    writeFileSync(join(brandDir, "App Logo.png"), "x");
    writeFileSync(join(brandDir, "bix-logo.png"), "x");

    expect(loadBrandAssets(root).logoPath).toBe(join(brandDir, "App Logo.png"));
  });

  it("lists the screenshots sorted by filename", () => {
    const root = tempRoot();
    const shotsDir = join(root, "assets", "brand", "screenshots");
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(shotsDir, "02-second.png"), "x");
    writeFileSync(join(shotsDir, "01-first.png"), "x");
    writeFileSync(join(shotsDir, "notes.txt"), "x"); // non-PNG ignored

    const assets = loadBrandAssets(root);
    expect(assets.screenshots).toEqual([
      join(shotsDir, "01-first.png"),
      join(shotsDir, "02-second.png"),
    ]);
  });

  it("resolves the two separate badges from screenshots/ and excludes them from the catalog", () => {
    const root = tempRoot();
    const shotsDir = join(root, "assets", "brand", "screenshots");
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(shotsDir, "01-first.png"), "x");
    writeFileSync(join(shotsDir, "APP STORE.png"), "x");
    writeFileSync(join(shotsDir, "PLAY STORE.png"), "x");

    const assets = loadBrandAssets(root);
    // The badges resolve to their dedicated roles...
    expect(assets.appStorePath).toBe(join(shotsDir, "APP STORE.png"));
    expect(assets.playStorePath).toBe(join(shotsDir, "PLAY STORE.png"));
    // ...and are NOT enumerated as feature screenshots / Wan refs.
    expect(assets.screenshots).toEqual([join(shotsDir, "01-first.png")]);
  });

  it("excludes the badges case-insensitively from the screenshot catalog", () => {
    const root = tempRoot();
    const shotsDir = join(root, "assets", "brand", "screenshots");
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(shotsDir, "app store.png"), "x");
    writeFileSync(join(shotsDir, "Play Store.png"), "x");
    writeFileSync(join(shotsDir, "05-feature.png"), "x");

    expect(loadBrandAssets(root).screenshots).toEqual([join(shotsDir, "05-feature.png")]);
  });

  it("prefers badges in screenshots/ over the old brand-root placeholders", () => {
    const root = tempRoot();
    const brandDir = join(root, "assets", "brand");
    const shotsDir = join(brandDir, "screenshots");
    mkdirSync(shotsDir, { recursive: true });
    writeFileSync(join(brandDir, "appstore.png"), "x");
    writeFileSync(join(brandDir, "playstore.png"), "x");
    writeFileSync(join(shotsDir, "APP STORE.png"), "x");
    writeFileSync(join(shotsDir, "PLAY STORE.png"), "x");

    const assets = loadBrandAssets(root);
    expect(assets.appStorePath).toBe(join(shotsDir, "APP STORE.png"));
    expect(assets.playStorePath).toBe(join(shotsDir, "PLAY STORE.png"));
  });

  it("prefers the brand title font over any system fallback", () => {
    const root = tempRoot();
    const fontDir = join(root, "assets", "brand", "fonts");
    mkdirSync(fontDir, { recursive: true });
    writeFileSync(join(fontDir, "title.ttf"), "x");

    const assets = loadBrandAssets(root);
    expect(assets.fontPath).toBe(join(fontDir, "title.ttf"));
  });
});
