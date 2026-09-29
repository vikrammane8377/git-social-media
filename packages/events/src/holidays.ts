import type { RawTopic } from "./types.js";
import { isIsoDate } from "./dates.js";

/** A source of official public holidays. Swappable, like the search provider. */
export interface HolidayClient {
  holidays(countryCode: string, year: number): Promise<RawTopic[]>;
}

/** Minimal fetch signature so tests can inject a stub. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Shape of one Nager.Date v3 PublicHolidays entry (the fields we use). */
interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
}

export const DEFAULT_HOLIDAY_BASE_URL = "https://date.nager.at/api/v3";

/**
 * Public holidays from Nager.Date (free, keyless). Uses the v3
 * `PublicHolidays/{year}/{countryCode}` endpoint, which returns both the local
 * (often Spanish) name and the English name. The base URL is injectable so it
 * can be pointed elsewhere or swapped for another provider later.
 */
export class NagerHolidayClient implements HolidayClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_HOLIDAY_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  async holidays(countryCode: string, year: number): Promise<RawTopic[]> {
    const url = `${this.baseUrl}/PublicHolidays/${year}/${countryCode}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new Error(`Holiday API returned ${res.status} for ${countryCode} ${year}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const topics: RawTopic[] = [];
    for (const entry of data as NagerHoliday[]) {
      if (!entry || !isIsoDate(entry.date)) continue;
      const local = typeof entry.localName === "string" ? entry.localName.trim() : "";
      const english = typeof entry.name === "string" ? entry.name.trim() : "";
      const title = local && english && local !== english ? `${local} (${english})` : local || english;
      if (!title) continue;
      topics.push({
        title,
        summary: `Public holiday in ${entry.countryCode ?? countryCode}.`,
        date: entry.date,
        sourceUrl: url,
        source: "holiday",
        country: entry.countryCode ?? countryCode,
      });
    }
    return topics;
  }
}
