import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { EventIdeaStore, ideaId } from "./store.js";
import type { ScoredTopic } from "./types.js";

function scored(title: string, date: string): ScoredTopic {
  return {
    id: ideaId("2026-10-01", title, date),
    title,
    summary: "s",
    date,
    sourceUrl: "https://ex",
    source: "web",
    score: { brandFit: 7, reason: "r", suggestedFormat: "short", postingWindow: { earliest: date, latest: date } },
  };
}

describe("EventIdeaStore", () => {
  it("saves kept ideas and is idempotent per (scan, title, date)", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new EventIdeaStore(db);
    store.init();

    store.saveKept("2026-10-01", [scored("Book fair", "2026-10-20"), scored("Holiday", "2026-10-15")]);
    expect(store.countForScan("2026-10-01")).toBe(2);

    // Re-saving the same scan replaces rather than duplicates.
    store.saveKept("2026-10-01", [scored("Book fair", "2026-10-20")]);
    expect(store.countForScan("2026-10-01")).toBe(2);

    db.close();
  });
});
