import { createHash } from "node:crypto";
import type { Database } from "@bix/storage";
import type { ScoredTopic } from "./types.js";

/** Deterministic id for one idea within a scan (stable across reruns of a day). */
export function ideaId(scanDate: string, title: string, eventDate: string): string {
  return createHash("sha256").update(`${scanDate}\u0000${title}\u0000${eventDate}`).digest("hex").slice(0, 16);
}

/** Persists kept ideas so later components (the content plan) can read them. */
export class EventIdeaStore {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_ideas (
        id               TEXT PRIMARY KEY,
        scan_date        TEXT NOT NULL,
        title            TEXT NOT NULL,
        summary          TEXT,
        event_date       TEXT NOT NULL,
        end_date         TEXT,
        source           TEXT NOT NULL,
        source_url       TEXT,
        country          TEXT,
        brand_fit        INTEGER NOT NULL,
        reason           TEXT,
        suggested_format TEXT,
        window_earliest  TEXT,
        window_latest    TEXT,
        created_at       TEXT NOT NULL
      )
    `);
  }

  /** Insert or replace all kept ideas from a scan. */
  saveKept(scanDate: string, topics: readonly ScoredTopic[], now: string = new Date().toISOString()): void {
    for (const t of topics) {
      this.db.run(
        `INSERT OR REPLACE INTO event_ideas
          (id, scan_date, title, summary, event_date, end_date, source, source_url,
           country, brand_fit, reason, suggested_format, window_earliest, window_latest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          scanDate,
          t.title,
          t.summary,
          t.date,
          t.endDate ?? null,
          t.source,
          t.sourceUrl,
          t.country ?? null,
          t.score.brandFit,
          t.score.reason,
          t.score.suggestedFormat,
          t.score.postingWindow.earliest,
          t.score.postingWindow.latest,
          now,
        ],
      );
    }
  }

  /** Count ideas saved for a given scan date (used by tests). */
  countForScan(scanDate: string): number {
    const row = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_ideas WHERE scan_date = ?", [scanDate]);
    return row ? Number(row.n) : 0;
  }
}
