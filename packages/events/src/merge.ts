import type { RawTopic } from "./types.js";

/** Normalise a title for duplicate detection (lowercase, strip punctuation/space). */
function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop parenthetical English glosses on holidays
    .replace(/[^a-z0-9áéíóúüñ]+/gi, " ")
    .trim();
}

/**
 * Merge topics from all sources and drop duplicates. Two topics are considered
 * the same if they share a normalised title and the same date. Earlier sources
 * win, so callers should pass authoritative sources first (holidays, then
 * curated calendar, then web search) to keep official dates.
 */
export function mergeTopics(...groups: RawTopic[][]): RawTopic[] {
  const seen = new Set<string>();
  const out: RawTopic[] = [];
  for (const group of groups) {
    for (const topic of group) {
      const key = `${normaliseTitle(topic.title)}|${topic.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(topic);
    }
  }
  return out;
}
