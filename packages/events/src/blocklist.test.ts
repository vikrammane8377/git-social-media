import { describe, it, expect } from "vitest";
import { checkBlocklist } from "./blocklist.js";
import type { RawTopic } from "./types.js";

function topic(partial: Partial<RawTopic>): RawTopic {
  return {
    title: "A topic",
    summary: "",
    date: "2026-10-15",
    sourceUrl: "https://example.com",
    source: "web",
    ...partial,
  };
}

describe("blocklist", () => {
  it("passes an on-brand topic", () => {
    expect(checkBlocklist(topic({ title: "Halloween costume ideas" }))).toBeNull();
  });

  it("blocks built-in categories case-insensitively", () => {
    expect(checkBlocklist(topic({ title: "Local ELECTION results" }))?.category).toBe("politics");
    expect(checkBlocklist(topic({ title: "Deadly earthquake" }))?.category).toBe("death");
    expect(checkBlocklist(topic({ summary: "A tragic massacre" }))?.category).toBe("tragedy");
  });

  it("blocks config keywords and reports them under 'config'", () => {
    const hit = checkBlocklist(topic({ title: "Big crypto crash" }), ["crypto"]);
    expect(hit).toEqual({ category: "config", keyword: "crypto" });
  });

  it("also scans extra text (the model's reason) in the post pass", () => {
    const hit = checkBlocklist(topic({ title: "Neutral title" }), [], "this relates to a war zone");
    expect(hit?.category).toBe("war");
  });
});
