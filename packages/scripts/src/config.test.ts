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
});
