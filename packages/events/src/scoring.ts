import type { RawTopic, TopicScore } from "./types.js";
import type { LlmClient } from "./llm.js";
import { parseJsonArray } from "./llm.js";
import { isIsoDate } from "./dates.js";

/**
 * Scores topics for brand fit. An interface so the scorer can be swapped or
 * mocked. Returns a score per input index; a missing index means "could not
 * score" and the caller decides what to do (we drop it).
 */
export interface TopicScorer {
  score(topics: readonly RawTopic[]): Promise<Map<number, TopicScore>>;
}

export interface OpenAiScorerDeps {
  client: LlmClient;
  model: string;
}

/** Clamp any numeric-ish input to an integer in [0, 10]. */
function clampScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * OpenAI-backed scorer. Sends the whole batch in one Responses API call (no web
 * search needed) and asks for a JSON array of scores keyed by index, so topics
 * and scores stay aligned even if the model reorders or drops some.
 */
export class OpenAiTopicScorer implements TopicScorer {
  private readonly client: LlmClient;
  private readonly model: string;

  constructor(deps: OpenAiScorerDeps) {
    this.client = deps.client;
    this.model = deps.model;
  }

  async score(topics: readonly RawTopic[]): Promise<Map<number, TopicScore>> {
    const result = new Map<number, TopicScore>();
    if (topics.length === 0) return result;

    const response = await this.client.create({ model: this.model, input: this.buildPrompt(topics) });
    const items = parseJsonArray(response.output_text);

    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as Record<string, unknown>;
      const index = typeof r.index === "number" ? r.index : Number(r.index);
      if (!Number.isInteger(index) || index < 0 || index >= topics.length) continue;

      const brandFit = clampScore(r.brandFit);
      if (brandFit === null) continue;

      const window = (r.postingWindow ?? {}) as Record<string, unknown>;
      const earliest = typeof window.earliest === "string" && isIsoDate(window.earliest) ? window.earliest : topics[index].date;
      const latest = typeof window.latest === "string" && isIsoDate(window.latest) ? window.latest : topics[index].date;

      result.set(index, {
        brandFit,
        reason: typeof r.reason === "string" ? r.reason.trim() : "",
        suggestedFormat: typeof r.suggestedFormat === "string" ? r.suggestedFormat.trim() : "",
        postingWindow: { earliest, latest },
      });
    }
    return result;
  }

  private buildPrompt(topics: readonly RawTopic[]): string {
    const list = topics
      .map((t, i) => `${i}. [${t.date}${t.endDate ? `..${t.endDate}` : ""}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}`)
      .join("\n");
    return [
      "You are a brand strategist for the Español workspace of a brand that helps",
      "Spanish speakers learn English (fun, upbeat, encouraging; mascot named Bix).",
      "",
      "Score each topic below for brand fit from 0 (skip it) to 10 (perfect fit).",
      "For each, give a one-line reason, a suggested content format, and a posting",
      "window (earliest and latest dates that make sense to post it).",
      "",
      "Topics:",
      list,
      "",
      "Return ONLY a JSON array (no prose), one element per topic you can score:",
      '{ "index": number, "brandFit": number, "reason": string,',
      '  "suggestedFormat": string,',
      '  "postingWindow": { "earliest": "YYYY-MM-DD", "latest": "YYYY-MM-DD" } }',
    ].join("\n");
  }
}
