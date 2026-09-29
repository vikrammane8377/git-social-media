import type { RawTopic } from "./types.js";

/** What the scan asks an event-search provider to find. */
export interface EventSearchRequest {
  /** ISO country codes whose audiences we care about. */
  countries: readonly string[];
  /** How many weeks ahead to look. */
  weeksAhead: number;
  /** Today's date, ISO YYYY-MM-DD, so the provider knows the window start. */
  today: string;
}

/**
 * A swappable source of upcoming topics discovered by search. Today this is
 * OpenAI web search; later it could be xAI Grok or another provider without the
 * rest of the scan changing.
 */
export interface EventSearchProvider {
  readonly name: string;
  search(request: EventSearchRequest): Promise<RawTopic[]>;
}
