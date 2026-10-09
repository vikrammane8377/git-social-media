import type { ChannelConfig as PostingChannel } from "@bix/config";
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
  /**
   * The posting channel this generator plans for. Its id stamps every slot and
   * its plannerBrief/posting replace the formerly hardcoded Spanish concept, so
   * the Global channel plans in English instead of silently staying Spanish.
   */
  channel: PostingChannel;
}

export interface PlanRequest {
  startDate: string;
  planDays: number;
  cadence: Cadence;
  insights: CompetitorInsights;
  events: EventIdea[];
  /** How many slots of each source the plan should aim for. */
  targets: { eventSlots: number; competitorSlots: number };
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
 * Builds a content plan by asking GPT-6 Astra to combine competitor insights,
 * the latest events scan, evergreen formats and the configured cadence.
 * Planning runs in two focused tracks (one LLM call each): an event track tied
 * to upcoming dated events, and a trend-based competitor track. Each track owns
 * one source, so attribution is guaranteed by construction. The model's output
 * is validated here: every slot must have a date inside the window and a known
 * source; anything else is dropped (no fake data). If the event track is short
 * on supply, the competitor cap is raised to still reach the total.
 */
export class OpenAiPlanGenerator {
  private readonly client: LlmClient;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly evergreenFormats: string[];
  private readonly channel: PostingChannel;

  constructor(deps: PlanGeneratorDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.reasoningEffort = deps.reasoningEffort;
    this.evergreenFormats = deps.evergreenFormats;
    this.channel = deps.channel;
  }

  async generate(request: PlanRequest): Promise<ContentPlan> {
    const { targets, cadence } = request;
    const start = request.startDate;

    // Widen the window so it can carry every post at the configured cadence.
    // 60 posts @ 5/week -> 84 days. Never shrink below the requested planDays.
    const total = targets.eventSlots + targets.competitorSlots;
    const effectiveDays = Math.max(
      request.planDays,
      Math.ceil((total / cadence.postsPerWeek) * 7),
    );
    const end = addDays(start, effectiveDays - 1);

    // Event track: only as many slots as the event supply (and target) allow.
    const eventSlots = await this.runTrack(
      this.buildEventPrompt(request, start, end, targets.eventSlots),
      "event",
      start,
      end,
      targets.eventSlots,
    );

    // Backfill: any event shortfall tops up the competitor cap so the plan
    // still reaches the combined total.
    const competitorCap = targets.competitorSlots + (targets.eventSlots - eventSlots.length);

    // Competitor track: trend-based, not anchored to any dated event.
    const competitorSlots = await this.runTrack(
      this.buildCompetitorPrompt(request, start, end, competitorCap),
      "competitor",
      start,
      end,
      competitorCap,
    );

    const slots = [...eventSlots, ...competitorSlots];
    slots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      month: monthKey(start),
      startDate: start,
      endDate: end,
      timezone: this.channel.posting.timezone,
      slots,
    };
  }

  /**
   * Run one planning track: a single LLM call whose output is validated by
   * {@link toSlot}, filtered to the expected source (defensive — the prompt
   * already fixes it), re-stamped with that source, and capped. Forcing the
   * source per track makes attribution deterministic regardless of model tags.
   */
  private async runTrack(
    prompt: string,
    expectedSource: SlotSource,
    start: string,
    end: string,
    cap: number,
  ): Promise<PlanSlot[]> {
    const response = await this.client.create({
      model: this.model,
      input: prompt,
      reasoningEffort: this.reasoningEffort,
    });

    const items = parseJsonArray(response.output_text);
    const slots: PlanSlot[] = [];
    for (const item of items) {
      const slot = this.toSlot(item, start, end);
      if (!slot || slot.source !== expectedSource) continue;
      slots.push({ ...slot, source: expectedSource });
    }
    return slots.slice(0, Math.max(0, cap));
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
      time: toStr(r.time) || this.channel.posting.time,
      channel: this.channel.id,
      format,
      source: source as SlotSource,
      topic,
      brandFit,
      hook: toStr(r.hook),
      why: toStr(r.why),
      assets: toStringArray(r.assets),
    };
  }

  /** Shared opening: brand voice, cadence, format mix, evergreen formats. */
  private promptHeader(request: PlanRequest, start: string, end: string): string[] {
    const { cadence } = request;
    const formatMix = Object.entries(cadence.formatMix)
      .map(([f, share]) => `  - ${f}: ${Math.round(share * 100)}%`)
      .join("\n");

    return [
      this.channel.plannerBrief,
      "",
      `Plan window: ${start} to ${end} (inclusive).`,
      `Cadence: about ${cadence.postsPerWeek} Shorts per week.`,
      `Posting time: ${this.channel.posting.time} (${this.channel.posting.timezone}).`,
      "",
      "Format mix (aim for roughly these shares):",
      formatMix,
      "",
      "Evergreen formats always available:",
      ...this.evergreenFormats.map((f) => `  - ${f}`),
    ];
  }

  /** Shared closing: date-window rule, JSON-array-only contract, schema. */
  private promptContract(start: string, end: string, source: SlotSource): string[] {
    return [
      "Rules:",
      "- Do NOT copy competitor scripts or wording; use formats and structure only.",
      "- Every slot's date MUST be between " + start + " and " + end + ".",
      `- Every slot's source MUST be "${source}".`,
      "- Keep the witty, mischievous voice in each hook.",
      "",
      "Return ONLY a JSON array (no prose) where each element is:",
      "{",
      '  "date": "YYYY-MM-DD",',
      '  "time": "HH:MM",',
      '  "format": string,',
      `  "source": "${source}",`,
      '  "topic": string,',
      '  "brandFit": number,       // 0-10',
      '  "hook": string,           // opening line in Bix\'s voice',
      '  "why": string,            // why this is in the plan',
      '  "assets": string[]        // assets the slot needs',
      "}",
    ];
  }

  /**
   * Event track prompt: schedule up to `cap` Shorts, each tied to one upcoming
   * event within its posting window. Insights are style guidance only, never
   * slot sources. Never invent events.
   */
  private buildEventPrompt(request: PlanRequest, start: string, end: string, cap: number): string {
    const { insights, events } = request;
    const eventLines =
      events.length > 0
        ? events.map(
            (e) =>
              `  - "${e.title}" on ${e.eventDate} (post between ${e.windowEarliest} and ${e.windowLatest}), brand-fit ${e.brandFit}/10, suggested format: ${e.suggestedFormat || "n/a"}`,
          )
        : ["  - (no upcoming events from the latest scan)"];

    return [
      ...this.promptHeader(request, start, end),
      "",
      "Competitor insights (STYLE guidance only — never copy scripts, never a slot source):",
      `  formats: ${insights.formats.join("; ") || "n/a"}`,
      `  hooks: ${insights.hooks.join("; ") || "n/a"}`,
      `  themes: ${insights.themes.join("; ") || "n/a"}`,
      "",
      "Upcoming events from the latest events scan (schedule each within its window):",
      ...eventLines,
      "",
      `Schedule up to ${cap} Shorts, each tied to ONE upcoming event within its`,
      "posting window. NEVER invent events — only use the events listed above.",
      "Every slot's source is always \"event\".",
      "",
      ...this.promptContract(start, end, "event"),
    ].join("\n");
  }

  /**
   * Competitor track prompt: produce exactly `cap` trend-based Shorts inspired
   * by the learned formats/hooks/themes, NOT tied to any calendar event. No
   * events are listed so the model cannot anchor to one.
   */
  private buildCompetitorPrompt(request: PlanRequest, start: string, end: string, cap: number): string {
    const { insights } = request;
    return [
      ...this.promptHeader(request, start, end),
      "",
      "Competitor insights (learned FORMATS/TRENDS only — never copy scripts):",
      `  formats: ${insights.formats.join("; ") || "n/a"}`,
      `  hooks: ${insights.hooks.join("; ") || "n/a"}`,
      `  lengths: ${insights.lengths || "n/a"}`,
      `  rhythm: ${insights.postingRhythm || "n/a"}`,
      `  themes: ${insights.themes.join("; ") || "n/a"}`,
      `  ctas: ${insights.ctas.join("; ") || "n/a"}`,
      "",
      `Produce exactly ${cap} trend-based Shorts inspired by the learned`,
      "formats/hooks/themes — NOT tied to any calendar event. Spread them across",
      "the window on cadence days; avoid clustering. Every slot's source is",
      'always "competitor". Do NOT copy competitor scripts.',
      "",
      ...this.promptContract(start, end, "competitor"),
    ].join("\n");
  }
}
