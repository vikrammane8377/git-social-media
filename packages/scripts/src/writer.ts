import type { AssetRecord } from "./asset-reader.js";
import type { LlmClient, ReasoningEffort } from "./llm.js";
import { parseJsonObject } from "./llm.js";
import type { PlanSlotRecord } from "./plan-slot-reader.js";
import type { NeededImage, ReviewResult, ScriptDraft } from "./types.js";

/** Hard cap on how many images the writer may request per script. */
export const MAX_NEEDED_IMAGES = 2;

/**
 * Target spoken-clip length range, in whole seconds. The default Wan provider
 * accepts 2-30s, so 25-30 keeps us within its contract while giving the script
 * room to breathe (a mini bit or short interaction rather than a one-liner).
 */
export const MIN_DURATION_SECONDS = 25;
export const MAX_DURATION_SECONDS = 30;

/**
 * Target spoken density, in words per second. The video model fits all of the
 * dialogue into the fixed clip length, so speech speed is really dialogue words
 * ÷ duration. ~2 words/sec is a relaxed, natural conversational pace; budgeting
 * the dialogue to this keeps Bix from sounding rushed. At 25-30s that is roughly
 * 50-60 words for the whole clip.
 */
export const TARGET_WORDS_PER_SECOND = 2;
const MIN_DIALOGUE_WORDS = MIN_DURATION_SECONDS * TARGET_WORDS_PER_SECOND;
const MAX_DIALOGUE_WORDS = MAX_DURATION_SECONDS * TARGET_WORDS_PER_SECOND;

/** Clamp a positive duration into the target [MIN, MAX] second range. */
function clampDuration(seconds: number): number {
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, seconds));
}

/** Per-field length caps for a requested image (keeps prompts bounded). */
const MAX_NEEDED_PROMPT_CHARS = 600;
const MAX_NEEDED_PURPOSE_CHARS = 120;

/**
 * Keep only well-formed image requests: each must have a non-empty string
 * `prompt` and `purpose`. Fields are trimmed and length-capped, and the list is
 * capped at {@link MAX_NEEDED_IMAGES}. Malformed entries are dropped; a missing
 * or non-array value yields []. Exported for unit testing.
 */
export function filterNeededImages(raw: unknown): NeededImage[] {
  if (!Array.isArray(raw)) return [];
  const out: NeededImage[] = [];
  for (const v of raw) {
    if (out.length >= MAX_NEEDED_IMAGES) break;
    if (typeof v !== "object" || v === null) continue;
    const r = v as Record<string, unknown>;
    const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
    const purpose = typeof r.purpose === "string" ? r.purpose.trim() : "";
    if (!prompt || !purpose) continue;
    out.push({
      prompt: prompt.slice(0, MAX_NEEDED_PROMPT_CHARS),
      purpose: purpose.slice(0, MAX_NEEDED_PURPOSE_CHARS),
    });
  }
  return out;
}

export interface ScriptWriterDeps {
  client: LlmClient;
  model: string;
  reasoningEffort: ReasoningEffort;
  /**
   * The channel persona/brief that opens every write + revise prompt. This is
   * the per-channel concept (Spanish vs. global English), so the writer plans in
   * the right language instead of a hardcoded Spanish voice.
   */
  writerPersona: string;
  /** Safety/claims guardrails the writer must respect (same list the reviewer enforces). */
  productFacts: string[];
  /**
   * The channel's spoken call-to-action, in the channel's language. The writer
   * must END every script's dialogue with this CTA (in Bix's voice) so the clip
   * flows straight from the lesson into the app-promo ending — no separate outro
   * clip. Wired from the channel config.
   */
  outroCta: string;
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The whole asset library is replayed into every write/revise prompt, so a long
 * per-asset analysis multiplies token cost as the library grows. Keep tags and
 * descriptions in full (short, high-signal) but trim the prose analysis to a
 * compact lead so selection stays cheap.
 */
const MAX_ASSET_ANALYSIS_CHARS = 200;

function trimAnalysis(analysis: string): string {
  if (analysis.length <= MAX_ASSET_ANALYSIS_CHARS) return analysis;
  return `${analysis.slice(0, MAX_ASSET_ANALYSIS_CHARS).trimEnd()}…`;
}

/**
 * Turn one content-plan slot into a spoken script using GPT-5.6 Sol. The writer
 * speaks in Bix's witty, mischievous voice, teaches English to Spanish speakers
 * (LatAm + Spain), and honours the slot's format/topic/hook/why. It asks for a
 * JSON object matching {@link ScriptDraft} and parses it with `parseJsonObject`;
 * a malformed reply yields a minimal draft carrying the raw text as a note so
 * the reviewer can still flag it rather than the run crashing.
 */
export class OpenAiScriptWriter {
  private readonly client: LlmClient;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly writerPersona: string;
  private readonly productFacts: string[];
  private readonly outroCta: string;

  constructor(deps: ScriptWriterDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.reasoningEffort = deps.reasoningEffort;
    this.writerPersona = deps.writerPersona;
    this.productFacts = deps.productFacts;
    this.outroCta = deps.outroCta;
  }

  /**
   * Write the first draft for a slot. `images` are optional data-URL vision
   * inputs (e.g. a feature screenshot the writer should demo); when present they
   * are forwarded to the model so it can see the exact feature it is scripting.
   */
  async write(
    slot: PlanSlotRecord,
    assets: readonly AssetRecord[] = [],
    images?: readonly string[],
  ): Promise<ScriptDraft> {
    const response = await this.client.create({
      model: this.model,
      input: this.buildWritePrompt(slot, assets),
      reasoningEffort: this.reasoningEffort,
      images,
    });
    return this.toDraft(response.output_text, assets);
  }

  /** Re-write a draft using the reviewer's issues. */
  async revise(
    slot: PlanSlotRecord,
    draft: ScriptDraft,
    review: ReviewResult,
    assets: readonly AssetRecord[] = [],
    images?: readonly string[],
  ): Promise<ScriptDraft> {
    const response = await this.client.create({
      model: this.model,
      input: this.buildRevisePrompt(slot, draft, review, assets),
      reasoningEffort: this.reasoningEffort,
      images,
    });
    return this.toDraft(response.output_text, assets);
  }

  private toDraft(text: string, assets: readonly AssetRecord[]): ScriptDraft {
    const obj = parseJsonObject(text);
    if (!obj) {
      // Never invent a script: hand back an empty draft carrying the raw text so
      // the reviewer sees there is nothing to pass.
      return {
        scenePrompt: "",
        dialogue: "",
        durationSeconds: 0,
        notes: `The writer returned no parseable JSON. Raw output: ${text.trim().slice(0, 500)}`,
        usedAssets: [],
        neededImages: [],
      };
    }
    const durationRaw = typeof obj.durationSeconds === "number" ? obj.durationSeconds : Number(obj.durationSeconds);
    const title = toStr(obj.title);
    const notes = toStr(obj.notes);
    return {
      title: title || undefined,
      scenePrompt: toStr(obj.scenePrompt),
      dialogue: toStr(obj.dialogue),
      durationSeconds:
        Number.isFinite(durationRaw) && durationRaw > 0 ? clampDuration(Math.round(durationRaw)) : 0,
      notes: notes || undefined,
      usedAssets: this.filterAssets(obj.usedAssets, assets),
      neededImages: filterNeededImages(obj.neededImages),
    };
  }

  /**
   * Keep only keys the model returned that actually exist in the library it was
   * shown — the model must never invent a reference path. Order and duplicates
   * are normalised (input order of the library, de-duplicated).
   */
  private filterAssets(raw: unknown, assets: readonly AssetRecord[]): string[] {
    if (!Array.isArray(raw) || assets.length === 0) return [];
    const allowed = new Set(assets.map((a) => a.key));
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v === "string" && allowed.has(v) && !out.includes(v)) {
        out.push(v);
      }
    }
    return out;
  }

  private assetBlock(assets: readonly AssetRecord[]): string[] {
    if (assets.length === 0) return [];
    return [
      "",
      "Reference image library (choose the ones that best fit this script; you may",
      "pick several or none). Return the chosen storage keys verbatim in usedAssets:",
      ...assets.map((a) => {
        const tags = a.tags.length > 0 ? a.tags.join(", ") : "(no tags)";
        const desc = a.description ? ` — ${a.description}` : "";
        const analysis = a.analysis ? ` | analysis: ${trimAnalysis(a.analysis)}` : "";
        return `  - key: ${a.key} | tags: ${tags}${desc}${analysis}`;
      }),
    ];
  }

  private guardrails(): string[] {
    return this.productFacts.map((f) => `  - ${f}`);
  }

  /**
   * Let the writer request brand-new reference images, but ONLY when the shown
   * library has no good fit. Each request carries a full image-gen prompt in
   * Bix's look (vertical, no on-screen text) and a one-line purpose. These are
   * synthesised and saved to the library in the generate phase.
   */
  private neededImagesInstructions(): string[] {
    return [
      "",
      "Reference-image policy: a library image only counts as a good fit when it",
      "already SHOWS this scene's specific look. A plain or neutral Bix portrait is",
      "NOT a fit for a scene that needs a particular costume, prop, holiday theme",
      "or setting (e.g. a Halloween costume, a flag, a seasonal backdrop). When the",
      "scene is visually specific and no library image already depicts it, request",
      `up to ${MAX_NEEDED_IMAGES} new image(s) via neededImages so the video has a`,
      "reference that matches the scene — this also becomes the video's thumbnail.",
      "Reuse an existing asset only when it genuinely depicts the scene; otherwise",
      "leave neededImages empty ([]) only if a generic Bix shot truly suffices.",
      "Each requested image needs a concise `prompt` describing the still in Bix's",
      "look (vertical 9:16, no on-screen text/captions/signs) and a one-line",
      "`purpose` label.",
    ];
  }

  /**
   * Duration guidance shared by the write and revise prompts: aim for a
   * 25-30 second Short and BUDGET the dialogue to a relaxed speaking pace
   * (~2 words/sec, ~50-60 words total) so Bix is never rushed. Fewer words
   * delivered well beats cramming — the clip length is fixed, so extra words
   * only make the speech faster.
   */
  private durationGuidance(): string[] {
    return [
      `Target a ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} second Short. The clip`,
      "length is FIXED, so speech speed is just how many words you write divided by",
      "the duration — too many words makes Bix talk fast and sound unpleasant.",
      `Budget the spoken dialogue to about ${TARGET_WORDS_PER_SECOND} words per second:`,
      `roughly ${MIN_DIALOGUE_WORDS}-${MAX_DIALOGUE_WORDS} words TOTAL for the whole clip.`,
      "Prefer fewer words spoken well — a short bit or a little back-and-forth with",
      "small pauses — over packing in sentences. Let the setup, the joke and the",
      "lesson breathe at a relaxed, natural pace and land the punchline.",
      `Set durationSeconds between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}.`,
    ];
  }

  private slotBlock(slot: PlanSlotRecord): string[] {
    return [
      `  source: ${slot.source}`,
      `  format: ${slot.format}`,
      `  topic: ${slot.topic}`,
      `  hook: ${slot.hook || "(none given — write one)"}`,
      `  why it's in the plan: ${slot.why || "(n/a)"}`,
      `  brand fit: ${slot.brandFit}/10`,
    ];
  }

  /**
   * A source-specific brief line. For a `feature` slot the attached screenshot
   * (passed as a vision input) IS the subject: Bix demos that exact app feature,
   * then flows into the app-promo ending. Other sources already carry their
   * intent in topic/hook/why, so they add no extra line.
   */
  private sourceBrief(slot: PlanSlotRecord): string[] {
    if (slot.source === "feature") {
      return [
        "",
        "FEATURE SHOWCASE: the attached screenshot shows one Bix Learn feature.",
        "Demo it — Bix enthusiastically shows off this exact feature on screen,",
        "explaining what it does in a quick, witty way, then moves into the",
        "app-promo ending below.",
      ];
    }
    return [];
  }

  /**
   * The REQUIRED spoken ending every script must finish on: Bix speaks the
   * channel's call-to-action verbatim (in the channel's language), and the scene
   * transitions to Bix holding up a phone showing the Bix Learn app. This bakes
   * the app-promo outro into the single clip so no separate outro is generated.
   */
  private ctaEnding(): string[] {
    return [
      "",
      "Required spoken ending (the clip is ONE continuous take — no separate outro):",
      "- END the dialogue with this exact call-to-action, in the channel's language,",
      `  kept in Bix's witty voice: "${this.outroCta}"`,
      "- In scenePrompt, END the scene by having Bix turn to camera and proudly hold",
      "  up a modern smartphone whose screen shows the Bix Learn app, in an upbeat,",
      "  polished app-commercial style. Still NO on-screen text, captions or signs.",
      "- Budget the dialogue so the lesson AND this CTA fit the duration at a relaxed",
      "  pace — the CTA is part of the spoken word count, not an extra.",
    ];
  }

  private buildWritePrompt(slot: PlanSlotRecord, assets: readonly AssetRecord[]): string {
    const usedAssetsField =
      assets.length > 0
        ? '  "usedAssets": string[]      // storage keys of chosen reference images (subset of the library above)'
        : '  "usedAssets": string[]      // leave empty [] — no reference library was provided';
    return [
      this.writerPersona,
      "",
      "Content-plan slot to script:",
      ...this.slotBlock(slot),
      ...this.sourceBrief(slot),
      ...this.assetBlock(assets),
      "",
      "Hard guardrails (must all hold):",
      ...this.guardrails(),
      "",
      ...this.durationGuidance(),
      ...this.ctaEnding(),
      "The scene is spoken only: describe the visual/motion but NEVER ask for",
      "on-screen text, captions, subtitles or signs.",
      ...this.neededImagesInstructions(),
      "",
      "Return ONLY a JSON object (no prose):",
      "{",
      '  "title": string,            // short working title',
      '  "scenePrompt": string,      // the visual scene + motion, no on-screen text',
      '  "dialogue": string,         // the exact line(s) Bix speaks',
      `  "durationSeconds": number,  // intended clip length, ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} seconds`,
      '  "notes": string,            // locale + the English meaning of the line',
      usedAssetsField,
      '  "neededImages": [{ "prompt": string, "purpose": string }]  // [] unless no library asset fits',
      "}",
    ].join("\n");
  }

  private buildRevisePrompt(
    slot: PlanSlotRecord,
    draft: ScriptDraft,
    review: ReviewResult,
    assets: readonly AssetRecord[],
  ): string {
    const usedAssetsField =
      assets.length > 0
        ? '  "usedAssets": string[]'
        : '  "usedAssets": string[]      // leave empty []';
    return [
      this.writerPersona,
      "",
      "You are revising a script the language reviewer asked you to fix.",
      "Make the SMALLEST adequate changes to resolve every issue below. Keep your",
      "established voice and the correct lesson; do not rewrite sound copy.",
      "",
      "Content-plan slot:",
      ...this.slotBlock(slot),
      ...this.sourceBrief(slot),
      ...this.assetBlock(assets),
      "",
      "Hard guardrails (must all hold):",
      ...this.guardrails(),
      ...this.ctaEnding(),
      "",
      "Your previous draft:",
      `  scenePrompt: ${JSON.stringify(draft.scenePrompt)}`,
      `  dialogue: ${JSON.stringify(draft.dialogue)}`,
      `  durationSeconds: ${draft.durationSeconds}`,
      "",
      "The reviewer's decision was REVISE. Issues to fix:",
      ...(review.issues.length > 0 ? review.issues.map((i) => `  - ${i}`) : ["  - (no explicit issues listed)"]),
      review.uncertainty ? `Reviewer uncertainty: ${review.uncertainty}` : "",
      "",
      ...this.durationGuidance(),
      ...this.neededImagesInstructions(),
      "",
      "Return ONLY a JSON object in the same shape as before:",
      "{",
      '  "title": string,',
      '  "scenePrompt": string,',
      '  "dialogue": string,',
      `  "durationSeconds": number,  // ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} seconds`,
      '  "notes": string,',
      usedAssetsField,
      '  "neededImages": [{ "prompt": string, "purpose": string }]',
      "}",
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}
