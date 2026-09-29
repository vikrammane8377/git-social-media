import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReasoningEffort } from "./llm.js";
import type { ChannelConfig } from "./types.js";
import type { Cadence } from "./plan.js";
import { DEFAULT_YOUTUBE_BASE_URL } from "./youtube.js";

/** Tunable settings for a competitor scan, from config/competitor-scan.json. */
export interface CompetitorScanConfig {
  /** Model for analysis + planning (GPT-6 Astra). */
  model: string;
  /** "medium mode" = reasoning.effort medium. */
  reasoningEffort: ReasoningEffort;
  /** Base URL for the YouTube Data API (swappable). */
  youtubeApiBaseUrl: string;
  /** Tracked competitor channels. */
  channels: ChannelConfig[];
  /** Max videos to pull per channel before filtering to Shorts. */
  maxVideosPerChannel: number;
  /** A clip counts as a Short at or under this many seconds. */
  maxShortSeconds: number;
  /** Length of the plan in days. */
  planDays: number;
  /** Posting cadence and format mix. */
  cadence: Cadence;
  /** Evergreen format ideas always available to the planner. */
  evergreenFormats: string[];
}

const DEFAULT_REASONING: ReasoningEffort = "medium";

export const DEFAULT_COMPETITOR_CONFIG: CompetitorScanConfig = {
  model: "gpt-6-astra",
  reasoningEffort: DEFAULT_REASONING,
  youtubeApiBaseUrl: DEFAULT_YOUTUBE_BASE_URL,
  channels: [
    { handle: "@duolingospanish", name: "Duolingo Spanish", weight: 1 },
    { handle: "@praktika_ai", name: "Praktika", weight: 1 },
    { handle: "@busuu", name: "Busuu", weight: 1 },
    { handle: "@falou_app", name: "Falou", weight: 0.5 },
  ],
  maxVideosPerChannel: 30,
  maxShortSeconds: 180,
  planDays: 30,
  cadence: {
    postsPerWeek: 5,
    timezone: "America/Mexico_City",
    postingTime: "09:00",
    formatMix: {
      "Responde a Bix": 0.4,
      "False-friend reveal": 0.2,
      "Speaking dare": 0.2,
      "Rehearse-then-panic": 0.2,
    },
  },
  evergreenFormats: [
    "Responde a Bix series",
    "Rehearse-then-panic",
    "False-friend reveal",
    "Speaking dare",
  ],
};

const REASONING_VALUES: ReadonlySet<string> = new Set<ReasoningEffort>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

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

function asChannels(value: unknown, fallback: ChannelConfig[]): ChannelConfig[] {
  if (!Array.isArray(value)) return fallback;
  const out: ChannelConfig[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "";
    const handle = typeof r.handle === "string" && r.handle.trim() ? r.handle.trim() : undefined;
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : undefined;
    if (!name || (!handle && !id)) continue;
    const weight = typeof r.weight === "number" && r.weight >= 0 ? r.weight : 1;
    out.push({ name, handle, id, weight });
  }
  return out.length > 0 ? out : fallback;
}

function asCadence(value: unknown, fallback: Cadence): Cadence {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  const formatMix: Record<string, number> = {};
  if (typeof r.formatMix === "object" && r.formatMix !== null) {
    for (const [k, v] of Object.entries(r.formatMix as Record<string, unknown>)) {
      if (typeof v === "number" && v >= 0) formatMix[k] = v;
    }
  }
  return {
    postsPerWeek:
      typeof r.postsPerWeek === "number" && r.postsPerWeek > 0 ? Math.floor(r.postsPerWeek) : fallback.postsPerWeek,
    timezone: typeof r.timezone === "string" && r.timezone.trim() ? r.timezone.trim() : fallback.timezone,
    postingTime: typeof r.postingTime === "string" && r.postingTime.trim() ? r.postingTime.trim() : fallback.postingTime,
    formatMix: Object.keys(formatMix).length > 0 ? formatMix : fallback.formatMix,
  };
}

/**
 * Load competitor-scan settings, falling back to defaults for any absent field.
 * Missing file = all defaults.
 */
export function loadCompetitorConfig(configDir: string): CompetitorScanConfig {
  const raw = readJson(resolve(configDir, "competitor-scan.json"));
  const d = DEFAULT_COMPETITOR_CONFIG;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const effort =
    typeof r.reasoningEffort === "string" && REASONING_VALUES.has(r.reasoningEffort)
      ? (r.reasoningEffort as ReasoningEffort)
      : d.reasoningEffort;
  return {
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : d.model,
    reasoningEffort: effort,
    youtubeApiBaseUrl:
      typeof r.youtubeApiBaseUrl === "string" && r.youtubeApiBaseUrl.trim()
        ? r.youtubeApiBaseUrl.trim()
        : d.youtubeApiBaseUrl,
    channels: asChannels(r.channels, d.channels),
    maxVideosPerChannel:
      typeof r.maxVideosPerChannel === "number" && r.maxVideosPerChannel > 0
        ? Math.floor(r.maxVideosPerChannel)
        : d.maxVideosPerChannel,
    maxShortSeconds:
      typeof r.maxShortSeconds === "number" && r.maxShortSeconds > 0 ? Math.floor(r.maxShortSeconds) : d.maxShortSeconds,
    planDays: typeof r.planDays === "number" && r.planDays > 0 ? Math.floor(r.planDays) : d.planDays,
    cadence: asCadence(r.cadence, d.cadence),
    evergreenFormats: asStringArray(r.evergreenFormats, d.evergreenFormats),
  };
}
