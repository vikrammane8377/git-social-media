import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScriptWriterConfig, DEFAULT_SCRIPT_WRITER_CONFIG } from "./config.js";

const dirs: string[] = [];
function tempConfigDir(file?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bix-script-"));
  dirs.push(dir);
  if (file !== undefined) writeFileSync(join(dir, "script-writer.json"), file);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadScriptWriterConfig", () => {
  it("returns defaults when the file is missing", () => {
    const config = loadScriptWriterConfig(tempConfigDir());
    expect(config.model).toBe("gpt-5.6-sol");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.maxRevisions).toBe(2);
    expect(config.video.provider).toBe("wan");
    expect(config.video.aspectRatio).toBe("9:16");
    expect(config.productFacts.length).toBe(DEFAULT_SCRIPT_WRITER_CONFIG.productFacts.length);
  });

  it("merges partial config per field, keeping defaults for the rest", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(
        JSON.stringify({
          maxRevisions: 1,
          video: { resolution: "1080p" },
          pricing: { inputPerMillion: 12, outputPerMillion: 60 },
        }),
      ),
    );
    expect(config.maxRevisions).toBe(1);
    // video.resolution overridden, other video fields default.
    expect(config.video.resolution).toBe("1080p");
    expect(config.video.aspectRatio).toBe("9:16");
    expect(config.pricing).toEqual({ inputPerMillion: 12, outputPerMillion: 60 });
    // model still defaults.
    expect(config.model).toBe("gpt-5.6-sol");
  });

  it("ignores an invalid reasoning effort", () => {
    const config = loadScriptWriterConfig(tempConfigDir(JSON.stringify({ reasoningEffort: "turbo" })));
    expect(config.reasoningEffort).toBe("medium");
  });

  it("overrides productFacts when a non-empty array is provided", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(JSON.stringify({ productFacts: ["only one fact"] })),
    );
    expect(config.productFacts).toEqual(["only one fact"]);
  });

  it("defaults the outro to an animated Wan outro with the icon + app-screen refs", () => {
    const config = loadScriptWriterConfig(tempConfigDir());
    expect(config.outro.enabled).toBe(true);
    expect(config.outro.mode).toBe("animated");
    expect(config.outro.durationSeconds).toBe(6);
    expect(config.outro.referenceAssets).toEqual([
      "assets/brand/app_icon.png",
      "assets/brand/screenshots/01-spanish-learning-path.png",
    ]);
    expect(config.outro.badgeOverlay).toBe(true);
    expect(config.outro.scenePrompt.length).toBeGreaterThan(0);
  });

  it("parses outro mode/referenceAssets/scenePrompt and rounds the duration to an int", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(
        JSON.stringify({
          outro: {
            mode: "endcard",
            durationSeconds: 2.5,
            referenceAssets: ["assets/brand/app_icon.png", "assets/brand/extra.png"],
            scenePrompt: "Custom outro scene.",
            badgeOverlay: false,
          },
        }),
      ),
    );
    expect(config.outro.mode).toBe("endcard");
    // 2.5 rounds to a whole second so Wan validates it.
    expect(config.outro.durationSeconds).toBe(3);
    expect(config.outro.referenceAssets).toEqual([
      "assets/brand/app_icon.png",
      "assets/brand/extra.png",
    ]);
    expect(config.outro.scenePrompt).toBe("Custom outro scene.");
    expect(config.outro.badgeOverlay).toBe(false);
  });

  it("ignores an invalid outro mode, keeping the animated default", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(JSON.stringify({ outro: { mode: "spinny" } })),
    );
    expect(config.outro.mode).toBe("animated");
  });

  it("defaults the outro appScreenshot and badgeTailSeconds", () => {
    const config = loadScriptWriterConfig(tempConfigDir());
    expect(config.outro.appScreenshot).toBe("assets/brand/screenshots/01-spanish-learning-path.png");
    expect(config.outro.badgeTailSeconds).toBe(6);
  });

  it("parses outro appScreenshot and rounds badgeTailSeconds to an int", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(
        JSON.stringify({
          outro: { appScreenshot: "assets/brand/screenshots/07-feature.png", badgeTailSeconds: 4.6 },
        }),
      ),
    );
    expect(config.outro.appScreenshot).toBe("assets/brand/screenshots/07-feature.png");
    expect(config.outro.badgeTailSeconds).toBe(5);
  });

  it("ignores a non-positive badgeTailSeconds, keeping the default", () => {
    const config = loadScriptWriterConfig(
      tempConfigDir(JSON.stringify({ outro: { badgeTailSeconds: 0 } })),
    );
    expect(config.outro.badgeTailSeconds).toBe(6);
  });
});
