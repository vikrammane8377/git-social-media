import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CalendarEntry } from "./calendar.js";
import { DEFAULT_HOLIDAY_BASE_URL } from "./holidays.js";

/** Tunable settings for a scan, loaded from config/events-scan.json. */
export interface ScanConfig {
  /** OpenAI model used for search and scoring. */
  model: string;
  /** How many weeks ahead to scan. */
  weeksAhead: number;
  /** Countries/audiences the web search should target (ISO codes). */
  searchCountries: string[];
  /** Countries whose official public holidays we always include (ISO codes). */
  holidayCountries: string[];
  /** Base URL for the holiday API (swappable). */
  holidayApiBaseUrl: string;
  /** Extra blocklist keywords on top of the built-in categories. */
  blocklistKeywords: string[];
}

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  model: "gpt-5.6",
  weeksAhead: 6,
  searchCountries: ["MX", "CO", "ES", "AR", "US", "GB"],
  holidayCountries: ["MX", "CO", "ES", "AR", "US", "GB"],
  holidayApiBaseUrl: DEFAULT_HOLIDAY_BASE_URL,
  blocklistKeywords: [],
};

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return undefined;
  return JSON.parse(text);
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Load scan settings from config/events-scan.json, falling back to defaults for
 * any field that is absent. Missing file = all defaults.
 */
export function loadScanConfig(configDir: string): ScanConfig {
  const raw = readJson(resolve(configDir, "events-scan.json"));
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SCAN_CONFIG };
  const r = raw as Record<string, unknown>;
  return {
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : DEFAULT_SCAN_CONFIG.model,
    weeksAhead:
      typeof r.weeksAhead === "number" && r.weeksAhead > 0 ? Math.floor(r.weeksAhead) : DEFAULT_SCAN_CONFIG.weeksAhead,
    searchCountries: asStringArray(r.searchCountries, DEFAULT_SCAN_CONFIG.searchCountries),
    holidayCountries: asStringArray(r.holidayCountries, DEFAULT_SCAN_CONFIG.holidayCountries),
    holidayApiBaseUrl:
      typeof r.holidayApiBaseUrl === "string" && r.holidayApiBaseUrl.trim()
        ? r.holidayApiBaseUrl.trim()
        : DEFAULT_SCAN_CONFIG.holidayApiBaseUrl,
    blocklistKeywords: asStringArray(r.blocklistKeywords, DEFAULT_SCAN_CONFIG.blocklistKeywords),
  };
}

/** Load owner-curated calendar entries from config/curated-calendar.json. */
export function loadCuratedCalendar(configDir: string): CalendarEntry[] {
  const raw = readJson(resolve(configDir, "curated-calendar.json"));
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is CalendarEntry => typeof e === "object" && e !== null);
}
