import type { EventSearchProvider, EventSearchRequest } from "./event-search.js";
import type { RawTopic } from "./types.js";
import type { LlmClient } from "./llm.js";
import { parseJsonArray } from "./llm.js";
import { addDays, isIsoDate, isWithin } from "./dates.js";

export interface OpenAiSearchDeps {
  client: LlmClient;
  model: string;
}

/**
 * Country codes -> readable names, used only to make the search prompt clearer.
 * Unknown codes fall through as their raw code.
 */
const COUNTRY_NAMES: Record<string, string> = {
  MX: "Mexico",
  CO: "Colombia",
  ES: "Spain",
  AR: "Argentina",
  US: "the United States",
  GB: "the United Kingdom",
};

function countryList(codes: readonly string[]): string {
  return codes.map((c) => COUNTRY_NAMES[c] ?? c).join(", ");
}

/**
 * Event search backed by the OpenAI Responses API with its built-in web search
 * tool (`{ type: "web_search" }`). It asks for upcoming, on-brand topics and
 * demands a real source URL and date for each; anything missing either is
 * discarded here so an unverifiable topic never reaches scoring.
 */
export class OpenAiEventSearch implements EventSearchProvider {
  readonly name = "openai-web-search";
  private readonly client: LlmClient;
  private readonly model: string;

  constructor(deps: OpenAiSearchDeps) {
    this.client = deps.client;
    this.model = deps.model;
  }

  async search(request: EventSearchRequest): Promise<RawTopic[]> {
    const windowStart = request.today;
    const windowEnd = addDays(request.today, request.weeksAhead * 7);
    const prompt = this.buildPrompt(request, windowStart, windowEnd);

    const response = await this.client.create({
      model: this.model,
      input: prompt,
      tools: [{ type: "web_search" }],
    });

    const items = parseJsonArray(response.output_text);
    const topics: RawTopic[] = [];
    for (const item of items) {
      const topic = this.toTopic(item, windowStart, windowEnd);
      if (topic) topics.push(topic);
    }
    return topics;
  }

  private buildPrompt(request: EventSearchRequest, start: string, end: string): string {
    const countries = countryList(request.countries);
    return [
      "You are a research assistant for a brand that teaches English to Spanish speakers.",
      `Use web search to find real, upcoming events between ${start} and ${end}`,
      `(the next ${request.weeksAhead} weeks).`,
      "",
      "Look for upcoming events, product releases, sports fixtures, cultural moments",
      `and online trends that matter to Spanish speakers in ${countries},`,
      "plus English-speaking cultural moments they would find interesting",
      "(US/UK holidays, big films, football).",
      "",
      "Rules:",
      "- Every item MUST have a real source URL you found via search and a specific date.",
      "- Do NOT invent or guess dates. If you cannot confirm a date from a source, omit the item.",
      `- Only include items whose date is between ${start} and ${end}.`,
      "- Prefer positive, light, culturally relevant moments.",
      "",
      "Return ONLY a JSON array (no prose) where each element is:",
      '{ "title": string, "summary": string, "date": "YYYY-MM-DD",',
      '  "endDate": "YYYY-MM-DD" | null, "url": string, "country": string | null }',
    ].join("\n");
  }

  private toTopic(item: unknown, start: string, end: string): RawTopic | null {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;

    const title = typeof record.title === "string" ? record.title.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const date = typeof record.date === "string" ? record.date.trim() : "";

    // Enforce the roadmap rule: discard anything without both a URL and a date.
    if (!title || !url || !isIsoDate(date)) return null;
    if (!/^https?:\/\//i.test(url)) return null;
    if (!isWithin(date, start, end)) return null;

    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    const endDate =
      typeof record.endDate === "string" && isIsoDate(record.endDate.trim())
        ? record.endDate.trim()
        : undefined;
    const country =
      typeof record.country === "string" && record.country.trim().length > 0
        ? record.country.trim()
        : undefined;

    return { title, summary, date, endDate, sourceUrl: url, source: "web", country };
  }
}
