import type { Database } from "@bix/storage";

/** A kept event idea from the latest Component 2 scan, as the plan needs it. */
export interface EventIdea {
  title: string;
  summary: string;
  eventDate: string;
  endDate?: string;
  brandFit: number;
  suggestedFormat: string;
  windowEarliest: string;
  windowLatest: string;
  sourceUrl: string;
}

interface EventIdeaRow {
  title: string;
  summary: string | null;
  event_date: string;
  end_date: string | null;
  brand_fit: number;
  suggested_format: string | null;
  window_earliest: string | null;
  window_latest: string | null;
  source_url: string | null;
}

/**
 * Reads kept ideas saved by Component 2 (`event_ideas` table). Returns the ideas
 * from the most recent scan whose events fall on or after `fromDate`, so the
 * plan only schedules events that are still upcoming. If the table does not
 * exist yet (events scan never run), returns [] rather than throwing.
 */
export class LatestEventsReader {
  constructor(private readonly db: Database) {}

  read(fromDate: string): EventIdea[] {
    if (!this.tableExists()) return [];

    const latest = this.db.get<{ scan_date: string }>(
      "SELECT scan_date FROM event_ideas ORDER BY scan_date DESC LIMIT 1",
    );
    if (!latest) return [];

    const rows = this.db.all<EventIdeaRow>(
      `SELECT title, summary, event_date, end_date, brand_fit, suggested_format,
              window_earliest, window_latest, source_url
         FROM event_ideas
        WHERE scan_date = ? AND event_date >= ?
        ORDER BY brand_fit DESC, event_date ASC`,
      [latest.scan_date, fromDate],
    );

    return rows.map((r) => ({
      title: r.title,
      summary: r.summary ?? "",
      eventDate: r.event_date,
      endDate: r.end_date ?? undefined,
      brandFit: Number(r.brand_fit),
      suggestedFormat: r.suggested_format ?? "",
      windowEarliest: r.window_earliest ?? r.event_date,
      windowLatest: r.window_latest ?? r.event_date,
      sourceUrl: r.source_url ?? "",
    }));
  }

  private tableExists(): boolean {
    const row = this.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_ideas'",
    );
    return Boolean(row);
  }
}
