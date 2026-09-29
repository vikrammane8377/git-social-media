import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { LatestEventsReader } from "./events-source.js";

function seed(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE event_ideas (
      id TEXT PRIMARY KEY, scan_date TEXT, title TEXT, summary TEXT, event_date TEXT,
      end_date TEXT, source TEXT, source_url TEXT, country TEXT, brand_fit INTEGER,
      reason TEXT, suggested_format TEXT, window_earliest TEXT, window_latest TEXT, created_at TEXT
    )
  `);
  const rows = [
    ["1", "2026-09-20", "Old scan idea", "2026-10-10", 9],
    ["2", "2026-09-29", "Latest high fit", "2026-10-15", 9],
    ["3", "2026-09-29", "Latest low fit", "2026-10-20", 4],
    ["4", "2026-09-29", "Already past", "2026-09-01", 8],
  ] as const;
  for (const [id, scan, title, date, fit] of rows) {
    db.run(
      `INSERT INTO event_ideas (id, scan_date, title, summary, event_date, source, source_url, brand_fit, suggested_format, window_earliest, window_latest, created_at)
       VALUES (?, ?, ?, '', ?, 'web', 'https://x', ?, 'skit', ?, ?, 'now')`,
      [id, scan, title, date, fit, date, date],
    );
  }
}

describe("LatestEventsReader", () => {
  it("returns [] when the table does not exist", () => {
    const db = new SqliteDatabase(":memory:");
    expect(new LatestEventsReader(db).read("2026-09-29")).toEqual([]);
    db.close();
  });

  it("reads only the latest scan, upcoming only, ordered by brand fit", () => {
    const db = new SqliteDatabase(":memory:");
    seed(db);
    const ideas = new LatestEventsReader(db).read("2026-09-29");
    db.close();

    // Old scan excluded; past event excluded; sorted by brand_fit desc
    expect(ideas.map((i) => i.title)).toEqual(["Latest high fit", "Latest low fit"]);
    expect(ideas[0].brandFit).toBe(9);
  });
});
