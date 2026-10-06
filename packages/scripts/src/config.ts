import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pricing, ReasoningEffort } from "./llm.js";

/** Video defaults baked into the emitted prompt file for `npm run video`. */
export interface VideoDefaults {
  resolution: string;
  aspectRatio: string;
  durationSeconds: number;
  generateAudio: boolean;
  /** Default provider name for the emitted prompt (wan|avatar|veo|kling|seedance). */
  provider: string;
}

/** Caption burn-in defaults (OpusClip), applied after video generation. */
export interface CaptionDefaults {
  /** When true, caption generated videos before publishing. */
  enabled: boolean;
  /** Spoken-language hint for transcription; "auto" lets OpusClip detect it. */
  sourceLang: string;
  /** Optional caption-style preset id; empty = OpusClip's default captions. */
  brandTemplateId?: string;
}

/** Image-generation defaults (GPT-Image via the OpenAI images API). */
export interface ImageGenDefaults {
  /**
   * Image model alias, swappable like the writer's `gpt-5.6-sol`. UNVERIFIED:
   * confirm the real model name before relying on it; failures are non-fatal.
   */
  model: string;
  /** Output size; "1024x1536" is the vertical 9:16 reference still. */
  size: string;
  /** Hard cap on generated images per run (cost guard). */
  maxImages: number;
}

/** Tunable settings for the script writer, from config/script-writer.json. */
export interface ScriptWriterConfig {
  /** Model for both the writer and the reviewer (GPT-5.6 Sol). */
  model: string;
  /** "medium mode" = reasoning.effort medium. */
  reasoningEffort: ReasoningEffort;
  /** Auto-revise at most this many times before stopping. */
  maxRevisions: number;
  /** Model pricing (USD per 1M tokens), for per-run cost reporting. */
  pricing: Pricing;
  /** Video defaults for the emitted prompt file. */
  video: VideoDefaults;
  /** Caption burn-in defaults (OpusClip). */
  captions: CaptionDefaults;
  /** Image-generation defaults (writer-requested references). */
  image: ImageGenDefaults;
  /** Safety/claims guardrails the reviewer enforces. */
  productFacts: string[];
}

const DEFAULT_REASONING: ReasoningEffort = "medium";

export const DEFAULT_SCRIPT_WRITER_CONFIG: ScriptWriterConfig = {
  model: "gpt-5.6-sol",
  reasoningEffort: DEFAULT_REASONING,
  maxRevisions: 2,
  // Placeholder list price for GPT-5.6 Sol — owner-editable. Documented as a
  // placeholder: confirm the real per-million rates before relying on the
  // dollar figures the CLI prints. Reasoning tokens bill as output.
  pricing: { inputPerMillion: 10, outputPerMillion: 50 },
  video: {
    resolution: "720p",
    aspectRatio: "9:16",
    durationSeconds: 28,
    generateAudio: true,
    provider: "wan",
  },
  captions: {
    enabled: true,
    sourceLang: "auto",
  },
  image: {
    // UNVERIFIED alias (GPT-Image-2.5 Sunburst) — swappable, like gpt-5.6-sol.
    model: "gpt-image-2.5-sunburst",
    size: "1024x1536",
    maxImages: 2,
  },
  // Seeded from docs/Bix-Learn-Marketing-Engine-Context.md and
  // docs/Bix-Learn-AI-Language-Reviewer.md. Owner-editable.
  productFacts: [
    "Do not promise fluency deadlines (e.g. \"fluent in 7 days\") or guaranteed results; use accurate, practice-focused wording instead.",
    "Do not claim free or unlimited access. \"Talk with Bix\" is an Ultra feature; do not infer free or unlimited conversations.",
    "The CTA is to download / use the Bix Learn app; the requested action and destination must be consistent.",
    "No on-screen text, captions, signs or subtitles in the scene — the clip is spoken only.",
    "Vertical 9:16 Short; keep the scene mobile-first and vertical.",
    "Brand voice is witty and mischievous; preserve the joke while keeping the actual lesson correct.",
    "Respect the locale: distinguish Spain and Latin American Spanish variants; do not label a valid regional form an error.",
    "Teach natural target-language usage; never teach a literal word-for-word translation as natural (watch false friends).",
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
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return out.length > 0 ? out : fallback;
}

function asPricing(value: unknown, fallback: Pricing): Pricing {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  return {
    inputPerMillion:
      typeof r.inputPerMillion === "number" && r.inputPerMillion >= 0 ? r.inputPerMillion : fallback.inputPerMillion,
    outputPerMillion:
      typeof r.outputPerMillion === "number" && r.outputPerMillion >= 0 ? r.outputPerMillion : fallback.outputPerMillion,
  };
}

function asVideoDefaults(value: unknown, fallback: VideoDefaults): VideoDefaults {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  return {
    resolution: typeof r.resolution === "string" && r.resolution.trim() ? r.resolution.trim() : fallback.resolution,
    aspectRatio: typeof r.aspectRatio === "string" && r.aspectRatio.trim() ? r.aspectRatio.trim() : fallback.aspectRatio,
    durationSeconds:
      typeof r.durationSeconds === "number" && r.durationSeconds > 0
        ? Math.floor(r.durationSeconds)
        : fallback.durationSeconds,
    generateAudio: typeof r.generateAudio === "boolean" ? r.generateAudio : fallback.generateAudio,
    provider: typeof r.provider === "string" && r.provider.trim() ? r.provider.trim() : fallback.provider,
  };
}

function asCaptionDefaults(value: unknown, fallback: CaptionDefaults): CaptionDefaults {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  const out: CaptionDefaults = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
    sourceLang:
      typeof r.sourceLang === "string" && r.sourceLang.trim() ? r.sourceLang.trim() : fallback.sourceLang,
  };
  const template =
    typeof r.brandTemplateId === "string" && r.brandTemplateId.trim()
      ? r.brandTemplateId.trim()
      : fallback.brandTemplateId;
  if (template) out.brandTemplateId = template;
  return out;
}

function asImageDefaults(value: unknown, fallback: ImageGenDefaults): ImageGenDefaults {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  return {
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : fallback.model,
    size: typeof r.size === "string" && r.size.trim() ? r.size.trim() : fallback.size,
    maxImages:
      typeof r.maxImages === "number" && r.maxImages >= 0 ? Math.floor(r.maxImages) : fallback.maxImages,
  };
}

/**
 * Load script-writer settings, falling back to defaults for any absent field.
 * Missing file = all defaults.
 */
export function loadScriptWriterConfig(configDir: string): ScriptWriterConfig {
  const raw = readJson(resolve(configDir, "script-writer.json"));
  const d = DEFAULT_SCRIPT_WRITER_CONFIG;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const effort =
    typeof r.reasoningEffort === "string" && REASONING_VALUES.has(r.reasoningEffort)
      ? (r.reasoningEffort as ReasoningEffort)
      : d.reasoningEffort;
  return {
    model: typeof r.model === "string" && r.model.trim() ? r.model.trim() : d.model,
    reasoningEffort: effort,
    maxRevisions:
      typeof r.maxRevisions === "number" && r.maxRevisions >= 0 ? Math.floor(r.maxRevisions) : d.maxRevisions,
    pricing: asPricing(r.pricing, d.pricing),
    video: asVideoDefaults(r.video, d.video),
    captions: asCaptionDefaults(r.captions, d.captions),
    image: asImageDefaults(r.image, d.image),
    productFacts: asStringArray(r.productFacts, d.productFacts),
  };
}
