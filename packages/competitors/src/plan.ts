import type { LlmClient, ReasoningEffort } from "./llm.js";
import { parseJsonArray } from "./llm.js";
import type { EventIdea } from "./events-source.js";
import type {
  CompetitorInsights,
  ContentPlan,
  PlanSlot,
  SlotSource,
} from "./types.js";
import { addDays, isWithin, monthKey } from "./dates.js";

/** Posting cadence + format mix, from config/competitor-scan.json. */
export interface Cadence {
  postsPerWeek: number;
  timezone: string;
  postingTime: string;
  /** Format -> relative share, e.g. { "Responde a Bix": 0.4, ... }. */
  formatMix: Record<string, number>;
}

export interface PlanGeneratorDeps {
  client: LlmClient;
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Evergreen format ideas that are always available. */
  evergreenFormats: string[];
}

export interface PlanRequest {
  startDate: string;
  planDays: number;
  cadence: Cadence;
  insights: CompetitorInsights;
  events: EventIdea[];
}

const VALID_SOURCES: ReadonlySet<string> = new Set<SlotSource>(["event", "competitor", "evergreen"]);

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

/**
 * Builds a 30-day content plan by asking GPT-6 Astra to combine competitor
 * insights, the latest events scan, evergreen formats and the configured
 * cadence. The model's output is validated here: every slot must have a date
 * inside the window and a known source; anything else is dropped (no fake data).
 */
export class OpenAiPlanGenerator {
  private readonly client: LlmClient;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly evergreenFormats: string[];

  constructor(deps: PlanGeneratorDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.reasoningEffort = deps.reasoningEffort;
    this.evergreenFormats = deps.evergreenFormats;
  }

  async generate(request: PlanRequest): Promise<ContentPlan> {
    const start = request.startDate;
    const end = addDays(start, request.planDays - 1);

    const prompt = this.buildPrompt(request, start, end);
    const response = await this.client.create({
      model: this.model,
      input: prompt,
      reasoningEffort: this.reasoningEffort,
    });

    const items = parseJsonArray(response.output_text);
    const slots: PlanSlot[] = [];
    for (const item of items) {
      const slot = this.toSlot(item, start, end);
      if (slot) slots.push(slot);
    }
    slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      month: monthKey(start),
      startDate: start,
      endDate: end,
      timezone: request.cadence.timezone,
      slots,
    };
  }

  private toSlot(item: unknown, start: string, end: string): PlanSlot | null {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;

    const date = toStr(r.date);
    if (!isWithin(date, start, end)) return null;

    const source = toStr(r.source).toLowerCase();
    if (!VALID_SOURCES.has(source)) return null;

    const topic = toStr(r.topic);
    const format = toStr(r.format);
    if (!topic || !format) return null;

    const brandFitRaw = typeof r.brandFit === "number" ? r.brandFit : Number(r.brandFit);
    const brandFit = Number.isFinite(brandFitRaw) ? Math.max(0, Math.min(10, Math.round(brandFitRaw))) : 0;

    return {
      date,
      time: toStr(r.time) || "09:00",
      format,
      source: source as SlotSource,
      topic,
      brandFit,
      hook: toStr(r.hook),
      why: toStr(r.why),
      assets: toStringArray(r.assets),
    };
  }

  private buildPrompt(request: PlanRequest, start: string, end: string): string {
    const { cadence, insights, events } = request;
    const formatMix = Object.entries(cadence.formatMix)
      .map(([f, share]) => `  - ${f}: ${Math.round(share * 100)}%`)
      .join("\n");

    const eventLines =
      events.length > 0
        ? events.map(
            (e) =>
              `  - "${e.title}" on ${e.eventDate} (post between ${e.windowEarliest} and ${e.windowLatest}), brand-fit ${e.brandFit}/10, suggested format: ${e.suggestedFormat || "n/a"}`,
          )
        : ["  - (no upcoming events from the latest scan)"];

    return [
      "You are the content planner for Bix Learn, a language app that teaches",
      "English to Spanish speakers (audience: Bix Learn Español). Brand voice is",
      "witty and mischievous. The CTA is to download / use the Bix Learn app.",
      "",
      `Build a content plan of Shorts from ${start} to ${end} (inclusive).`,
      `Cadence: about ${cadence.postsPerWeek} Shorts per week.`,
      `Posting time: ${cadence.postingTime} (${cadence.timezone}).`,
      "",
      "Format mix (aim for roughly these shares; Responde a Bix is the largest):",
      formatMix,
      "",
      "Evergreen formats always available:",
      ...this.evergreenFormats.map((f) => `  - ${f}`),
      "",
      "Competitor insights (learned FORMATS/TRENDS only — never copy scripts):",
      `  formats: ${insights.formats.join("; ") || "n/a"}`,
      `  hooks: ${insights.hooks.join("; ") || "n/a"}`,
      `  lengths: ${insights.lengths || "n/a"}`,
      `  rhythm: ${insights.postingRhythm || "n/a"}`,
      `  themes: ${insights.themes.join("; ") || "n/a"}`,
      `  ctas: ${insights.ctas.join("; ") || "n/a"}`,
      "",
      "Upcoming events from the latest events scan (schedule each within its window):",
      ...eventLines,
      "",
      "Rules:",
      "- Do NOT copy competitor scripts or wording; use formats and structure only.",
      "- Event slots MUST fall within the event's posting window.",
      "- Every slot's date MUST be between " + start + " and " + end + ".",
      "- Mark each slot's source as one of: event, competitor, evergreen.",
      "- Keep the witty, mischievous voice in each hook.",
      "",
      "Return ONLY a JSON array (no prose) where each element is:",
      "{",
      '  "date": "YYYY-MM-DD",',
      '  "time": "HH:MM",',
      '  "format": string,',
      '  "source": "event" | "competitor" | "evergreen",',
      '  "topic": string,',
      '  "brandFit": number,       // 0-10',
      '  "hook": string,           // opening line in Bix\'s voice',
      '  "why": string,            // why this is in the plan',
      '  "assets": string[]        // assets the slot needs',
      "}",
    ].join("\n");
  }
}
