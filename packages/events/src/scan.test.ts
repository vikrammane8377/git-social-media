import { describe, it, expect } from "vitest";
import { runScan } from "./scan.js";
import type { EventSearchProvider } from "./event-search.js";
import type { HolidayClient } from "./holidays.js";
import type { TopicScorer } from "./scoring.js";
import type { RawTopic, TopicScore } from "./types.js";

const TODAY = new Date("2026-10-01T00:00:00Z"); // window end = 2026-10-29 at weeksAhead 4

function web(title: string, date: string): RawTopic {
  return { title, summary: "", date, sourceUrl: "https://ex/" + encodeURIComponent(title), source: "web" };
}

const search: EventSearchProvider = {
  name: "mock-search",
  search: async () => [
    web("Comic convention", "2026-10-10"),
    web("Terrible shooting downtown", "2026-10-12"), // pre-blocked (tragedy)
    web("Late thing", "2026-11-30"), // out of window
    web("Neutral festival", "2026-10-18"), // survives pre; blocked post via reason
  ],
};

const holidays: HolidayClient = {
  holidays: async (country) => [
    { title: `Holiday-${country}`, summary: "", date: "2026-10-15", sourceUrl: "https://nager", source: "holiday", country },
  ],
};

function score(brandFit: number, reason: string): TopicScore {
  return { brandFit, reason, suggestedFormat: "short", postingWindow: { earliest: "2026-10-01", latest: "2026-10-20" } };
}

// Survivors after window + pre-block are, in order:
//   0 Holiday-MX, 1 Book fair (calendar), 2 Comic convention, 3 Neutral festival
const scorer: TopicScorer = {
  score: async () =>
    new Map<number, TopicScore>([
      [0, score(8, "great cultural moment")],
      [1, score(7, "fun and on brand")],
      // index 2 deliberately unscored -> dropped
      [3, score(6, "ties into the election season")], // post-blocked (politics)
    ]),
};

describe("runScan", () => {
  it("gathers, dedupes, windows, blocks (pre and post), scores and assembles", async () => {
    const result = await runScan({
      search,
      holidays,
      scorer,
      calendar: [{ title: "Book fair", summary: "", date: "2026-10-20", sourceUrl: "(curated calendar)", source: "calendar" }],
      holidayCountries: ["MX"],
      searchCountries: ["MX"],
      weeksAhead: 4,
      blocklistKeywords: [],
      today: TODAY,
    });

    expect(result.date).toBe("2026-10-01");

    const keptTitles = result.kept.map((k) => k.title).sort();
    expect(keptTitles).toEqual(["Book fair", "Holiday-MX"]);

    // Comic convention was unscored -> not kept, not blocked.
    expect(result.kept.some((k) => k.title === "Comic convention")).toBe(false);

    const blocked = result.blocked;
    expect(blocked.find((b) => b.topic.title.includes("shooting"))?.stage).toBe("pre");
    expect(blocked.find((b) => b.topic.title === "Neutral festival")?.stage).toBe("post");
    expect(blocked.find((b) => b.topic.title === "Late thing")).toBeUndefined();

    // Kept ideas carry a deterministic id and their score.
    const holiday = result.kept.find((k) => k.title === "Holiday-MX");
    expect(holiday?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(holiday?.score.brandFit).toBe(8);
  });
});
