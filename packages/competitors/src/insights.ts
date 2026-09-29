import type { LlmClient, ReasoningEffort } from "./llm.js";
import { parseJsonObject } from "./llm.js";
import type { CompetitorInsights, CompetitorVideo } from "./types.js";

export interface CompetitorAnalystDeps {
  client: LlmClient;
  model: string;
  reasoningEffort: ReasoningEffort;
}

/** A single video reduced to the fields the analyst prompt needs. */
function videoLine(v: CompetitorVideo): string {
  const parts = [
    `channel="${v.channelName}"`,
    `weight=${v.weight}`,
    `duration=${v.durationSeconds}s`,
    `title=${JSON.stringify(v.title)}`,
  ];
  if (v.viewCount !== undefined) parts.push(`views=${v.viewCount}`);
  if (v.likeCount !== undefined) parts.push(`likes=${v.likeCount}`);
  if (v.commentCount !== undefined) parts.push(`comments=${v.commentCount}`);
  parts.push(`published=${v.publishedAt}`);
  return `- ${parts.join(", ")}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Summarise competitor Shorts into patterns (formats, hooks, lengths, rhythm,
 * themes, CTAs). It learns FORMATS AND TRENDS ONLY and must never copy scripts.
 * Weighted channels (Falou lower) are passed through so the model can weight its
 * read. Uses GPT-6 Astra with web search so it can enrich thin metadata.
 */
export class OpenAiCompetitorAnalyst {
  private readonly client: LlmClient;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;

  constructor(deps: CompetitorAnalystDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.reasoningEffort = deps.reasoningEffort;
  }

  async summarise(videos: readonly CompetitorVideo[]): Promise<CompetitorInsights> {
    const empty: CompetitorInsights = {
      formats: [],
      hooks: [],
      lengths: "",
      postingRhythm: "",
      themes: [],
      ctas: [],
      notes: ["No competitor videos were available to analyse."],
    };
    if (videos.length === 0) return empty;

    const prompt = this.buildPrompt(videos);
    const response = await this.client.create({
      model: this.model,
      input: prompt,
      tools: [{ type: "web_search" }],
      reasoningEffort: this.reasoningEffort,
    });

    const obj = parseJsonObject(response.output_text);
    if (!obj) {
      return { ...empty, notes: ["The analyst returned no parseable summary."] };
    }

    const notes = toStringArray(obj.notes);
    return {
      formats: toStringArray(obj.formats),
      hooks: toStringArray(obj.hooks),
      lengths: toStr(obj.lengths),
      postingRhythm: toStr(obj.postingRhythm),
      themes: toStringArray(obj.themes),
      ctas: toStringArray(obj.ctas),
      // Always keep the reach caveat visible even if the model omits it.
      notes: notes.length > 0 ? notes : ["Public counts cannot distinguish organic vs paid reach or audience nationality."],
    };
  }

  private buildPrompt(videos: readonly CompetitorVideo[]): string {
    return [
      "You analyse competitor YouTube Shorts for a brand (Bix Learn) that teaches",
      "English to Spanish speakers with a witty, mischievous voice.",
      "",
      "Below are recent Shorts from tracked competitors (Duolingo, Praktika, Busuu,",
      "Falou). 'weight' shows how much to trust each channel (lower = less).",
      "",
      "Identify PATTERNS AND FORMATS ONLY. Do NOT copy or reproduce any script,",
      "caption or line of content. Learn structure, not wording.",
      "",
      "Videos:",
      ...videos.map(videoLine),
      "",
      "You may use web search to understand a format if the title is unclear.",
      "",
      "State clearly in `notes` that public counts cannot distinguish organic vs",
      "paid reach or audience nationality.",
      "",
      "Return ONLY a JSON object (no prose):",
      "{",
      '  "formats": string[],        // recurring content formats',
      '  "hooks": string[],          // opening-hook patterns',
      '  "lengths": string,          // typical length range and what works',
      '  "postingRhythm": string,    // how often / when they post',
      '  "themes": string[],         // recurring themes/topics',
      '  "ctas": string[],           // call-to-action patterns',
      '  "notes": string[]           // caveats, incl. the reach caveat above',
      "}",
    ].join("\n");
  }
}
