import { describe, it, expect } from "vitest";
import { mergeTopics } from "./merge.js";
import type { RawTopic } from "./types.js";

function t(title: string, date: string, source: RawTopic["source"], url = "https://x"): RawTopic {
  return { title, summary: "", date, sourceUrl: url, source };
}

describe("mergeTopics", () => {
  it("removes duplicates by normalised title + date, keeping the first source", () => {
    // The holiday's English gloss in parentheses is ignored, so a second source
    // returning the local name on the same date is treated as the same topic.
    const holidays = [t("Navidad (Christmas Day)", "2026-12-25", "holiday")];
    const web = [t("navidad", "2026-12-25", "web")];
    const merged = mergeTopics(holidays, web);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("holiday");
  });

  it("keeps same title on different dates", () => {
    const merged = mergeTopics([t("Match day", "2026-10-01", "web"), t("Match day", "2026-10-08", "web")]);
    expect(merged).toHaveLength(2);
  });

  it("preserves order across groups", () => {
    const merged = mergeTopics([t("A", "2026-10-01", "holiday")], [t("B", "2026-10-02", "calendar")], [t("C", "2026-10-03", "web")]);
    expect(merged.map((m) => m.title)).toEqual(["A", "B", "C"]);
  });
});
