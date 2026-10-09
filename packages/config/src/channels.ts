import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * A posting channel: one YouTube channel (Brand Account) the pipeline plans,
 * scripts, and publishes for. The day's axis is the channel (one slot per
 * enabled channel per day), replacing the old event/competitor split. Every
 * stage — the plan generator, script writer, metadata builder, and publisher —
 * reads the persona, facts, metadata and auth token from here so a new channel
 * is a config change, not a code change.
 *
 * Defaults ship in {@link DEFAULT_CHANNELS}; `config/channels.json` overrides
 * fields per channel; a dashboard-writable settings store can override again at
 * runtime (passed to {@link loadChannels} as `overrides`). Precedence is
 * DEFAULT_CHANNELS <- config/channels.json <- runtime overrides.
 */

/** Stable channel key, used in slots, CLI flags, and token filenames. */
export type ChannelId = "spanish" | "global";

/** The canonical list of channel ids, in display order. */
export const CHANNEL_IDS: readonly ChannelId[] = ["spanish", "global"];

/** Per-channel YouTube metadata defaults (footer, category, tags). */
export interface ChannelMetadata {
  /** Footer appended to auto-built video descriptions. */
  descriptionFooter: string;
  /** YouTube category id ("27" = Education). */
  categoryId: string;
  /** Tags added to every upload for the channel. */
  defaultTags: string[];
}

/** Per-channel posting schedule (editable default; the owner sets the real time). */
export interface ChannelPosting {
  /** Local clock time, "HH:MM". */
  time: string;
  /** IANA timezone, e.g. "America/Mexico_City" or "UTC". */
  timezone: string;
}

/** Everything a channel needs across plan, script, metadata and publish. */
export interface ChannelConfig {
  /** Stable key used in slots, CLI, token filenames. */
  id: ChannelId;
  /** Human-readable channel name, e.g. "Bix Learn Español". */
  label: string;
  /** When false, the daily plan and runner skip this channel. */
  enabled: boolean;
  /** OAuth token file, relative to the repo root: data/youtube-tokens.<id>.json. */
  tokenFile: string;
  /** Primary spoken language, e.g. "es" | "en". */
  primaryLanguage: string;
  /** Persona/brief injected into the plan generator's prompt header. */
  plannerBrief: string;
  /** Persona injected into the script writer's prompt. */
  writerPersona: string;
  /** Safety/claims guardrails the writer and reviewer enforce. */
  productFacts: string[];
  /** YouTube metadata defaults. */
  metadata: ChannelMetadata;
  /** Posting schedule default. */
  posting: ChannelPosting;
}

/** A runtime/file override for one channel: any subset of its fields. */
export type ChannelOverride = Partial<Omit<ChannelConfig, "id" | "metadata" | "posting">> & {
  metadata?: Partial<ChannelMetadata>;
  posting?: Partial<ChannelPosting>;
};

/** A map of per-channel overrides, e.g. parsed from JSON or a settings store. */
export type ChannelOverrides = Partial<Record<ChannelId, ChannelOverride>>;

/**
 * Product facts shared by both channels. The locale fact is channel-specific
 * and appended in each channel's own list below.
 */
const SHARED_PRODUCT_FACTS: readonly string[] = [
  'Do not promise fluency deadlines (e.g. "fluent in 7 days") or guaranteed results; use accurate, practice-focused wording instead.',
  'Do not claim free or unlimited access. "Talk with Bix" is an Ultra feature; do not infer free or unlimited conversations.',
  "The CTA is to download / use the Bix Learn app; the requested action and destination must be consistent.",
  "No on-screen text, captions, signs or subtitles in the scene — the clip is spoken only.",
  "Vertical 9:16 Short; keep the scene mobile-first and vertical.",
  "Brand voice is witty and mischievous; preserve the joke while keeping the actual lesson correct.",
  "Teach natural target-language usage; never teach a literal word-for-word translation as natural (watch false friends).",
];

/** Built-in defaults for both channels. Owner-editable via config/channels.json. */
export const DEFAULT_CHANNELS: Record<ChannelId, ChannelConfig> = {
  spanish: {
    id: "spanish",
    label: "Bix Learn Español",
    enabled: true,
    tokenFile: "data/youtube-tokens.spanish.json",
    primaryLanguage: "es",
    plannerBrief: [
      "You are the content planner for Bix Learn, a language app that teaches",
      "English to Spanish speakers (audience: Bix Learn Español). Brand voice is",
      "witty and mischievous. The CTA is to download / use the Bix Learn app.",
    ].join("\n"),
    writerPersona: [
      "You are Bix, the witty and mischievous mascot of Bix Learn, a language app.",
      "Write the spoken script for one vertical (9:16) YouTube Short that teaches",
      "English to Spanish speakers across Latin America and Spain. Speak mostly in",
      "Spanish, weaving in the English being practised. Keep the quick wit, cheeky",
      "challenges and playful overconfidence — but the actual lesson must be correct.",
    ].join("\n"),
    productFacts: [
      ...SHARED_PRODUCT_FACTS,
      "Respect the locale: distinguish Spain and Latin American Spanish variants; do not label a valid regional form an error.",
    ],
    metadata: {
      descriptionFooter: "—\nCreado por Bix · contenido educativo generado con ayuda de IA.",
      categoryId: "27",
      defaultTags: ["Bix Learn", "aprender inglés", "inglés", "español"],
    },
    posting: { time: "13:00", timezone: "America/Mexico_City" },
  },
  global: {
    id: "global",
    label: "Bix Global",
    enabled: true,
    tokenFile: "data/youtube-tokens.global.json",
    primaryLanguage: "en",
    plannerBrief: [
      "You are the content planner for Bix Global, the worldwide channel of Bix",
      "Learn, a language app. The audience is a global, English-first audience of",
      "language learners. Build ideas around three wells: current global events,",
      "the world's top languages (English, Spanish, French, German), and Bix app",
      "features. Same witty, mischievous Bix mascot. The CTA is to download / use",
      "the Bix Learn app.",
    ].join("\n"),
    writerPersona: [
      "You are Bix, the witty and mischievous mascot of Bix Learn, a language app,",
      "on its global channel. Write the spoken script for one vertical (9:16)",
      "YouTube Short for a worldwide audience. Speak primarily in English; you may",
      "weave in a word or short phrase from the language being taught (English,",
      "Spanish, French or German) when it lands the joke or the lesson. Tie the bit",
      "to a global event, a top-language quirk, or a Bix app feature. Keep the quick",
      "wit, cheeky challenges and playful overconfidence — but the lesson must be",
      "correct.",
    ].join("\n"),
    productFacts: [
      ...SHARED_PRODUCT_FACTS,
      "Respect each language's regional variants; do not label a valid regional form an error.",
    ],
    metadata: {
      descriptionFooter: "—\nCreated by Bix · educational content made with the help of AI.",
      categoryId: "27",
      defaultTags: ["Bix Learn", "language learning", "English", "Spanish", "French", "German"],
    },
    posting: { time: "18:00", timezone: "UTC" },
  },
};

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return undefined;
  return JSON.parse(text);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return out.length > 0 ? out : fallback;
}

/** Normalise an unknown JSON value into a validated {@link ChannelOverride}. */
function asOverride(value: unknown): ChannelOverride {
  if (typeof value !== "object" || value === null) return {};
  const r = value as Record<string, unknown>;
  const out: ChannelOverride = {};
  if (typeof r.label === "string" && r.label.trim()) out.label = r.label.trim();
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.tokenFile === "string" && r.tokenFile.trim()) out.tokenFile = r.tokenFile.trim();
  if (typeof r.primaryLanguage === "string" && r.primaryLanguage.trim()) {
    out.primaryLanguage = r.primaryLanguage.trim();
  }
  if (typeof r.plannerBrief === "string" && r.plannerBrief.trim()) out.plannerBrief = r.plannerBrief;
  if (typeof r.writerPersona === "string" && r.writerPersona.trim()) out.writerPersona = r.writerPersona;
  if (Array.isArray(r.productFacts)) {
    out.productFacts = r.productFacts
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
  }
  if (typeof r.metadata === "object" && r.metadata !== null) {
    const m = r.metadata as Record<string, unknown>;
    const metadata: Partial<ChannelMetadata> = {};
    if (typeof m.descriptionFooter === "string") metadata.descriptionFooter = m.descriptionFooter;
    if (typeof m.categoryId === "string" && m.categoryId.trim()) metadata.categoryId = m.categoryId.trim();
    if (Array.isArray(m.defaultTags)) {
      metadata.defaultTags = m.defaultTags
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim());
    }
    out.metadata = metadata;
  }
  if (typeof r.posting === "object" && r.posting !== null) {
    const p = r.posting as Record<string, unknown>;
    const posting: Partial<ChannelPosting> = {};
    if (typeof p.time === "string" && p.time.trim()) posting.time = p.time.trim();
    if (typeof p.timezone === "string" && p.timezone.trim()) posting.timezone = p.timezone.trim();
    out.posting = posting;
  }
  return out;
}

/** Apply one validated override on top of a base channel config. */
function mergeChannel(base: ChannelConfig, override: ChannelOverride | undefined): ChannelConfig {
  if (!override) return base;
  return {
    id: base.id,
    label: asString(override.label, base.label),
    enabled: typeof override.enabled === "boolean" ? override.enabled : base.enabled,
    tokenFile: asString(override.tokenFile, base.tokenFile),
    primaryLanguage: asString(override.primaryLanguage, base.primaryLanguage),
    plannerBrief: asString(override.plannerBrief, base.plannerBrief),
    writerPersona: asString(override.writerPersona, base.writerPersona),
    productFacts: override.productFacts && override.productFacts.length > 0
      ? override.productFacts
      : base.productFacts,
    metadata: {
      descriptionFooter: asString(override.metadata?.descriptionFooter, base.metadata.descriptionFooter),
      categoryId: asString(override.metadata?.categoryId, base.metadata.categoryId),
      defaultTags: asStringArray(override.metadata?.defaultTags, base.metadata.defaultTags),
    },
    posting: {
      time: asString(override.posting?.time, base.posting.time),
      timezone: asString(override.posting?.timezone, base.posting.timezone),
    },
  };
}

/** Parse the `channels` map out of config/channels.json into overrides. */
function fileOverrides(configDir: string): ChannelOverrides {
  const raw = readJson(resolve(configDir, "channels.json"));
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const source = typeof r.channels === "object" && r.channels !== null ? (r.channels as Record<string, unknown>) : r;
  const out: ChannelOverrides = {};
  for (const id of CHANNEL_IDS) {
    if (id in source) out[id] = asOverride(source[id]);
  }
  return out;
}

/**
 * Load every channel, merging DEFAULT_CHANNELS <- config/channels.json <-
 * runtime `overrides` (e.g. the dashboard settings store). Returns all channels
 * in canonical order regardless of their `enabled` flag; callers filter on it.
 */
export function loadChannels(configDir: string, overrides: ChannelOverrides = {}): ChannelConfig[] {
  const fromFile = fileOverrides(configDir);
  return CHANNEL_IDS.map((id) => {
    const withFile = mergeChannel(DEFAULT_CHANNELS[id], fromFile[id]);
    return mergeChannel(withFile, overrides[id]);
  });
}

/** Load a single channel by id (same merge precedence as {@link loadChannels}). */
export function getChannel(
  id: ChannelId,
  configDir: string,
  overrides: ChannelOverrides = {},
): ChannelConfig {
  return loadChannels(configDir, overrides).find((c) => c.id === id) ?? DEFAULT_CHANNELS[id];
}

/** The enabled channels only, in canonical order. */
export function enabledChannels(configDir: string, overrides: ChannelOverrides = {}): ChannelConfig[] {
  return loadChannels(configDir, overrides).filter((c) => c.enabled);
}

/** True when `value` is a known channel id. */
export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && (CHANNEL_IDS as readonly string[]).includes(value);
}

/**
 * Read the per-channel overrides currently stored in `config/channels.json`
 * (the same layer {@link loadChannels} merges). Returns `{}` when the file is
 * absent or empty. This is the dashboard's editable channel state: writing it
 * back with {@link writeChannelOverrides} is what lets CLI runs pick up changes,
 * since every pipeline stage reads the file through the loader.
 */
export function readChannelOverrides(configDir: string): ChannelOverrides {
  return fileOverrides(configDir);
}

/**
 * Persist per-channel overrides to `config/channels.json` as `{ channels: {…} }`
 * (the shape {@link fileOverrides} prefers). Only the keys present on each
 * override are written; omit a field to keep inheriting the built-in default.
 */
export function writeChannelOverrides(configDir: string, overrides: ChannelOverrides): void {
  const path = resolve(configDir, "channels.json");
  const channels: Record<string, ChannelOverride> = {};
  for (const id of CHANNEL_IDS) {
    const o = overrides[id];
    if (o) channels[id] = asOverride(o);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ channels }, null, 2)}\n`, "utf8");
}
