import type { RawTopic } from "./types.js";
import { isIsoDate } from "./dates.js";

/** One entry as written in config/curated-calendar.json (owner-editable). */
export interface CalendarEntry {
  title: string;
  summary?: string;
  date: string;
  endDate?: string;
  url?: string;
  country?: string;
}

/**
 * Turn curated calendar entries into topics. Entries missing a valid title or
 * date are skipped (the file is hand-edited, so we tolerate mistakes rather than
 * crash). A missing URL is fine here: these are owner-curated, not search
 * results, so they get a "(curated calendar)" reference instead.
 */
export function calendarTopics(entries: readonly CalendarEntry[]): RawTopic[] {
  const topics: RawTopic[] = [];
  for (const entry of entries) {
    const title = typeof entry?.title === "string" ? entry.title.trim() : "";
    if (!title || !isIsoDate(entry.date)) continue;
    const endDate = typeof entry.endDate === "string" && isIsoDate(entry.endDate) ? entry.endDate : undefined;
    const url = typeof entry.url === "string" && entry.url.trim().length > 0 ? entry.url.trim() : "(curated calendar)";
    const country = typeof entry.country === "string" && entry.country.trim().length > 0 ? entry.country.trim() : undefined;
    topics.push({
      title,
      summary: typeof entry.summary === "string" ? entry.summary.trim() : "",
      date: entry.date,
      endDate,
      sourceUrl: url,
      source: "calendar",
      country,
    });
  }
  return topics;
}
