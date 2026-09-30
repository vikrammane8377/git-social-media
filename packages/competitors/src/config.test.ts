import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompetitorConfig, DEFAULT_COMPETITOR_CONFIG } from "./config.js";

const dirs: string[] = [];
function tempConfigDir(file?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bix-comp-"));
  dirs.push(dir);
  if (file !== undefined) writeFileSync(join(dir, "competitor-scan.json"), file);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadCompetitorConfig", () => {
  it("returns defaults when the file is missing", () => {
    const config = loadCompetitorConfig(tempConfigDir());
    expect(config.model).toBe("gpt-6-astra");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.channels.length).toBe(DEFAULT_COMPETITOR_CONFIG.channels.length);
    expect(config.pricing).toEqual({ inputPerMillion: 10, outputPerMillion: 50 });
  });

  it("merges custom pricing over defaults", () => {
    const config = loadCompetitorConfig(
      tempConfigDir(JSON.stringify({ pricing: { inputPerMillion: 12, outputPerMillion: 60 } })),
    );
    expect(config.pricing).toEqual({ inputPerMillion: 12, outputPerMillion: 60 });
  });

  it("merges partial config over defaults and validates channels", () => {
    const config = loadCompetitorConfig(
      tempConfigDir(
        JSON.stringify({
          reasoningEffort: "high",
          maxShortSeconds: 60,
          channels: [
            { handle: "@x", name: "X", weight: 2 },
            { name: "no id or handle" },
          ],
        }),
      ),
    );
    expect(config.reasoningEffort).toBe("high");
    expect(config.maxShortSeconds).toBe(60);
    // model still defaults
    expect(config.model).toBe("gpt-6-astra");
    // second channel dropped (no id/handle)
    expect(config.channels).toHaveLength(1);
    expect(config.channels[0].name).toBe("X");
  });

  it("ignores an invalid reasoning effort", () => {
    const config = loadCompetitorConfig(tempConfigDir(JSON.stringify({ reasoningEffort: "turbo" })));
    expect(config.reasoningEffort).toBe("medium");
  });
});
