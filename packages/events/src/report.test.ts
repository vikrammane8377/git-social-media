import { describe, it, expect } from "vitest";
import { renderReport } from "./report.js";
import type { ScanResult } from "./types.js";

const result: ScanResult = {
  date: "2026-10-01",
  kept: [
    {
      id: "abc123",
      title: "Book fair",
      summary: "A local fair",
      date: "2026-10-20",
      sourceUrl: "https://ex/fair",
      source: "web",
      score: { brandFit: 6, reason: "fun", suggestedFormat: "short", postingWindow: { earliest: "2026-10-15", latest: "2026-10-20" } },
    },
    {
      id: "def456",
      title: "Holiday-MX",
      summary: "",
      date: "2026-10-15",
      sourceUrl: "https://nager",
      source: "holiday",
      country: "MX",
      score: { brandFit: 9, reason: "big cultural moment", suggestedFormat: "clip", postingWindow: { earliest: "2026-10-10", latest: "2026-10-15" } },
    },
  ],
  blocked: [{ topic: { title: "Shooting", summary: "", date: "2026-10-12", sourceUrl: "https://ex", source: "web" }, reason: "tragedy: shooting", stage: "pre" }],
};

describe("renderReport", () => {
  it("lists kept ideas highest brand fit first and shows blocked reasons", () => {
    const md = renderReport(result);
    expect(md).toContain("# Events scan — 2026-10-01");
    expect(md).toContain("Kept: 2 · Blocked: 1");
    // Holiday-MX (9) should appear before Book fair (6).
    expect(md.indexOf("Holiday-MX")).toBeLessThan(md.indexOf("Book fair"));
    expect(md).toContain("`9/10`");
    expect(md).toContain("Shooting");
    expect(md).toContain("blocked pre-scoring: tragedy: shooting");
  });

  it("handles an empty scan", () => {
    const md = renderReport({ date: "2026-10-01", kept: [], blocked: [] });
    expect(md).toContain("## Kept ideas");
    expect(md).toContain("_None._");
  });
});
