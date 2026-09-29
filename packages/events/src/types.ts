/** Where a topic came from. Kept small so new sources can be added later. */
export type TopicSource = "web" | "holiday" | "calendar";

/**
 * A single candidate topic before it has been scored. Every topic carries a date
 * and a source reference; the web-search source additionally requires a real URL
 * (enforced in the search adapter) so the model can never invent an event.
 */
export interface RawTopic {
  title: string;
  summary: string;
  /** Event date (or range start) as ISO YYYY-MM-DD. */
  date: string;
  /** Optional range end as ISO YYYY-MM-DD. */
  endDate?: string;
  /** A URL for web topics, or a canonical reference for holidays/curated entries. */
  sourceUrl: string;
  source: TopicSource;
  /** ISO country code when the topic is tied to one (e.g. a national holiday). */
  country?: string;
}

/** The score the model assigns to one topic for the Español workspace. */
export interface TopicScore {
  /** Brand fit from 0 (skip) to 10 (perfect). */
  brandFit: number;
  /** One-line reason for the score. */
  reason: string;
  /** Suggested content format (e.g. "Responde a Bix short"). */
  suggestedFormat: string;
  /** Earliest and latest sensible posting dates, ISO YYYY-MM-DD. */
  postingWindow: { earliest: string; latest: string };
}

/** A topic that survived the blocklist and has been scored. */
export interface ScoredTopic extends RawTopic {
  /** Deterministic id derived from the scan date + title + event date. */
  id: string;
  score: TopicScore;
}

/** A topic removed by the blocklist, with the reason it was removed. */
export interface BlockedTopic {
  topic: RawTopic;
  /** Human-readable reason, e.g. "politics: election". */
  reason: string;
  /** Whether it was caught before or after scoring. */
  stage: "pre" | "post";
}

/** The full result of one scan run. */
export interface ScanResult {
  /** Scan date, ISO YYYY-MM-DD. */
  date: string;
  kept: ScoredTopic[];
  blocked: BlockedTopic[];
}
