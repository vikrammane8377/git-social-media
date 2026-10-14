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
  /**
   * Brand art direction appended to every image-gen prompt. Generated stills for
   * event-specific scenes otherwise have no art direction and land on odd
   * backgrounds, which Wan then carries into the whole clip (and the thumbnail).
   * This gives them the clean, consistent look Spanish gets from the curated
   * `bix_stand.png` reference.
   */
  artDirection: string;
}

/** Designed-thumbnail defaults (composited via ffmpeg, channel-agnostic). */
export interface ThumbnailDefaults {
  /** When true, replace the raw still with a designed 1080x1920 thumbnail. */
  enabled: boolean;
}

/** Outro mode: an animated per-video Wan outro, or the static ffmpeg end-card. */
export type OutroMode = "animated" | "endcard";

/** Branded outro defaults (animated Wan outro, or the static end-card fallback). */
export interface OutroDefaults {
  /** When true, append an outro to every clip. */
  enabled: boolean;
  /**
   * "animated" seeds Wan with the main clip's last frame for a per-video,
   * seamless outro; "endcard" uses the static ffmpeg end-card directly. The
   * static end-card is also the non-fatal fallback whenever "animated" fails.
   */
  mode: OutroMode;
  /**
   * Outro length in seconds. Wan needs a whole second 2-30, so this is rounded
   * to an integer and clamped at generation time; default 3.
   */
  durationSeconds: number;
  /**
   * Extra Wan reference image(s) for the animated outro (the `reference_image`
   * role), on top of the last-frame `start_image`. Default: the hi-res app icon.
   */
  referenceAssets: string[];
  /** Scene/motion prompt for the animated outro (no on-screen text; CTA is spoken). */
  scenePrompt: string;
  /** When true, composite the store badges onto the CTA tail of the clip via ffmpeg. */
  badgeOverlay: boolean;
  /**
   * The app-screen reference passed to Wan for the spoken CTA ending of a
   * non-feature clip (feature slots use their own screenshot). A home-screen
   * screenshot so Bix's phone shows the real app. Relative to the repo root.
   */
  appScreenshot: string;
  /**
   * How many seconds at the END of the clip the store badges are shown over
   * (the CTA tail). The overlay is gated with `enable=gte(t, duration - this)`.
   */
  badgeTailSeconds: number;
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
  /** Designed-thumbnail defaults. */
  thumbnail: ThumbnailDefaults;
  /** Branded end-card / outro defaults. */
  outro: OutroDefaults;
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
    artDirection: [
      "Art direction: a clean, uncluttered backdrop consistent with Bix's brand",
      "palette; soft, flattering lighting; the subject centered and fully in frame;",
      "high production value; match the reference image's background and style.",
    ].join(" "),
  },
  thumbnail: {
    enabled: true,
  },
  outro: {
    enabled: true,
    mode: "animated",
    durationSeconds: 6,
    referenceAssets: [
      "assets/brand/app_icon.png",
      "assets/brand/screenshots/01-spanish-learning-path.png",
    ],
    scenePrompt: [
      "Bix, the character from the reference image, stands in a bright, playful,",
      "on-brand studio and turns to camera with a big friendly smile, then proudly",
      "holds up a modern smartphone. The phone screen clearly shows the Bix Learn",
      "app interface from the reference screenshot. Polished, energetic app-commercial",
      "style with soft shapes, confetti and gentle sparkles, and a slow camera push-in.",
      "No on-screen text.",
    ].join(" "),
    badgeOverlay: true,
    appScreenshot: "assets/brand/screenshots/01-spanish-learning-path.png",
    badgeTailSeconds: 6,
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
    artDirection:
      typeof r.artDirection === "string" && r.artDirection.trim()
        ? r.artDirection.trim()
        : fallback.artDirection,
  };
}

function asThumbnailDefaults(value: unknown, fallback: ThumbnailDefaults): ThumbnailDefaults {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
  };
}

function asOutroDefaults(value: unknown, fallback: OutroDefaults): OutroDefaults {
  if (typeof value !== "object" || value === null) return fallback;
  const r = value as Record<string, unknown>;
  const mode: OutroMode = r.mode === "animated" || r.mode === "endcard" ? r.mode : fallback.mode;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled,
    mode,
    // Wan takes whole seconds; round so a fractional override still validates.
    durationSeconds:
      typeof r.durationSeconds === "number" && r.durationSeconds > 0
        ? Math.round(r.durationSeconds)
        : fallback.durationSeconds,
    referenceAssets: asStringArray(r.referenceAssets, fallback.referenceAssets),
    scenePrompt:
      typeof r.scenePrompt === "string" && r.scenePrompt.trim()
        ? r.scenePrompt.trim()
        : fallback.scenePrompt,
    badgeOverlay: typeof r.badgeOverlay === "boolean" ? r.badgeOverlay : fallback.badgeOverlay,
    appScreenshot:
      typeof r.appScreenshot === "string" && r.appScreenshot.trim()
        ? r.appScreenshot.trim()
        : fallback.appScreenshot,
    // Wan takes whole seconds; round so a fractional override still validates.
    badgeTailSeconds:
      typeof r.badgeTailSeconds === "number" && r.badgeTailSeconds > 0
        ? Math.round(r.badgeTailSeconds)
        : fallback.badgeTailSeconds,
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
    thumbnail: asThumbnailDefaults(r.thumbnail, d.thumbnail),
    outro: asOutroDefaults(r.outro, d.outro),
    productFacts: asStringArray(r.productFacts, d.productFacts),
  };
}
