import type { LlmClient, ReasoningEffort } from "./llm.js";
import { parseJsonObject } from "./llm.js";

/**
 * Canonical description of the Bix mascot, the single source of truth shared by
 * the asset analyzer (vision context) and the image generator (style anchor).
 */
export const BIX_MASCOT_DESCRIPTION =
  "Bix — a witty, mischievous tan-and-cream beagle with dark floppy ears, round glasses, a white collared shirt, charcoal vest and red tie";

/**
 * Analyses an uploaded image against the whole Bix Learn project using a
 * vision-capable model, so the asset library self-describes: it returns a short
 * analysis of how the image fits the brand and concise tags for retrieval. The
 * server runs this in the background after an upload and feeds the result back
 * to the script writer (via the asset library).
 *
 * UNVERIFIED: this reuses the `gpt-5.6-sol` alias for vision via the Responses
 * API image input. If that alias is not vision-capable, swap the model in
 * config/script-writer.json — the analyze call fails gracefully and the upload
 * still succeeds (the server marks analysis_status = "error").
 */
export interface AssetAnalysisInput {
  /** Raw image bytes. */
  bytes: Buffer;
  /** MIME type, e.g. "image/png" — used to build the data URL. */
  mime: string;
  filename: string;
  /** Tags the uploader typed (may be empty). */
  tags: string[];
  /** Description the uploader typed (may be empty). */
  description: string;
}

export interface AssetAnalysis {
  /** Prose analysis of the image with respect to the project. */
  analysis: string;
  /** Concise lowercase tags suggested for retrieval. */
  tags: string[];
}

export interface AssetAnalyzerDeps {
  client: LlmClient;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Project guardrails/product facts, reused as context. */
  productFacts: string[];
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class AssetAnalyzer {
  private readonly client: LlmClient;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly productFacts: string[];

  constructor(deps: AssetAnalyzerDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.reasoningEffort = deps.reasoningEffort;
    this.productFacts = deps.productFacts;
  }

  async analyze(input: AssetAnalysisInput): Promise<AssetAnalysis> {
    const dataUrl = `data:${input.mime || "image/png"};base64,${input.bytes.toString("base64")}`;
    const response = await this.client.create({
      model: this.model,
      input: this.buildPrompt(input),
      images: [dataUrl],
      reasoningEffort: this.reasoningEffort,
    });
    return this.toAnalysis(response.output_text);
  }

  private toAnalysis(text: string): AssetAnalysis {
    const obj = parseJsonObject(text);
    if (!obj) {
      // Never invent structure: keep the raw prose as the analysis, no tags.
      // Cap it — this line is replayed into the writer prompt for every asset.
      return { analysis: text.trim().slice(0, 240), tags: [] };
    }
    return {
      analysis: toStr(obj.description) || toStr(obj.analysis),
      tags: this.normaliseTags(obj.tags),
    };
  }

  private normaliseTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const t = v.trim().toLowerCase();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  private buildPrompt(input: AssetAnalysisInput): string {
    const tags = input.tags.length > 0 ? input.tags.join(", ") : "(none)";
    const desc = input.description ? input.description : "(none)";
    return [
      "You are the asset librarian for Bix Learn, a language-learning app. Its",
      `mascot is ${BIX_MASCOT_DESCRIPTION}. The`,
      "marketing team makes vertical (9:16) YouTube Shorts that teach English to",
      "Spanish speakers across Spain and Latin America. Uploaded images are kept as",
      "a reference library the script writer draws on when generating those Shorts.",
      "",
      "Analyse the attached image for THIS project. In ONE short, direct sentence",
      "(max ~25 words, no preamble) say what it shows and how it could be used as a",
      "reference in a Short. Lead with anything distinctive the writer can match to a",
      "topic or occasion — e.g. what Bix is WEARING if it differs from the default",
      "outfit (costume, jersey, hat, seasonal/festive dress), notable PROPS or other",
      "elements (a Spanish/Mexican flag, a landmark, holiday or sports items), and",
      "the OCCASION it suits (national day, holiday, a specific country or season).",
      "If it is the plain default Bix, just say so. Be terse — this line is sent to",
      "the script writer for every asset, so keep it compact.",
      "",
      "Project guardrails for context (do not repeat them back):",
      ...this.productFacts.map((f) => `  - ${f}`),
      "",
      `Uploader tags: ${tags}`,
      `Uploader description: ${desc}`,
      "",
      "Then propose a handful of concise, lowercase, single- or two-word tags that",
      "help retrieve this image later. Cover subjects, style and setting, and ALSO —",
      "when present — attire/outfit (e.g. jersey, santa-hat), props (e.g. flag,",
      "guitar), nationality/flag (e.g. spain, mexico), and occasion/event-fit (e.g.",
      "national-day, christmas, world-cup) so themed slots can find the right asset.",
      "",
      "Return ONLY a JSON object (no prose):",
      "{",
      '  "description": string,   // ONE short sentence: what it is + how to use it',
      '  "tags": string[]         // concise lowercase retrieval tags',
      "}",
    ].join("\n");
  }
}
