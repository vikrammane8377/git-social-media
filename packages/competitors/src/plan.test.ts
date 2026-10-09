import { describe, it, expect } from "vitest";
import { OpenAiPlanGenerator, type Cadence, type PlanRequest } from "./plan.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { CompetitorInsights } from "./types.js";
import type { ChannelConfig } from "@bix/config";
import { addDays } from "./dates.js";

/** A Spanish-channel fixture: supplies plannerBrief + posting the generator reads. */
const channel: ChannelConfig = {
  id: "spanish",
  label: "Bix Learn Español",
  enabled: true,
  tokenFile: "data/youtube-tokens.spanish.json",
  primaryLanguage: "es",
  plannerBrief: "Bix teaches English to Spanish speakers.",
  writerPersona: "Witty Bix persona.",
  productFacts: [],
  metadata: { descriptionFooter: "", categoryId: "27", defaultTags: [] },
  posting: { time: "09:00", timezone: "America/Mexico_City" },
};

const cadence: Cadence = {
  postsPerWeek: 5,
  timezone: "America/Mexico_City",
  postingTime: "09:00",
  formatMix: { "Responde a Bix": 0.4, "Speaking dare": 0.6 },
};

const insights: CompetitorInsights = {
  formats: ["skit"],
  hooks: ["question"],
  lengths: "15-30s",
  postingRhythm: "daily",
  themes: ["false friends"],
  ctas: ["download"],
  notes: [],
};

const targets = { eventSlots: 30, competitorSlots: 30 };

/** Returns queued outputs in order (event call first, competitor call second). */
function sequencedClient(outputs: string[], calls: LlmRequest[]): LlmClient {
  let i = 0;
  return {
    async create(request: LlmRequest) {
      calls.push(request);
      const out = outputs[i] ?? "[]";
      i += 1;
      return { output_text: out };
    },
  };
}

function baseRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return { startDate: "2026-10-01", planDays: 30, cadence, insights, events: [], targets, ...overrides };
}

function item(date: string, source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { date, time: "09:00", format: "Speaking dare", source, topic: "t", brandFit: 8, hook: "h", why: "w", assets: [], ...extra };
}

describe("OpenAiPlanGenerator two-track generate", () => {
  it("merges both tracks, tags by source, widens the window, and sorts by date", async () => {
    const calls: LlmRequest[] = [];
    const eventOut = JSON.stringify([
      item("2026-10-05", "event", { brandFit: 12 }), // clamped to 10
      item("2026-10-01", "event"), // earlier — tests sort
      item("2026-12-31", "event"), // out of window (end 2026-12-23) -> dropped
      item("2026-10-03", "competitor"), // wrong source in event track -> dropped
      item("2026-10-04", "event", { topic: "" }), // malformed -> dropped
    ]);
    const compOut = JSON.stringify([
      item("2026-11-10", "competitor"),
      item("2026-10-02", "event"), // wrong source in competitor track -> dropped
      item("2026-11-05", "competitor"),
    ]);
    const gen = new OpenAiPlanGenerator({
      client: sequencedClient([eventOut, compOut], calls),
      model: "gpt-6-astra",
      reasoningEffort: "medium",
      evergreenFormats: ["Responde a Bix series"],
      channel,
    });

    const plan = await gen.generate(baseRequest());

    expect(calls).toHaveLength(2);
    expect(plan.slots.map((s) => s.date)).toEqual(["2026-10-01", "2026-10-05", "2026-11-05", "2026-11-10"]);
    expect(plan.slots.map((s) => s.source)).toEqual(["event", "event", "competitor", "competitor"]);
    // brandFit clamped to 0-10 on the kept event slot
    expect(plan.slots[1].brandFit).toBe(10);
    // 30+30 @ 5/week -> 84-day window (2026-10-01 .. 2026-12-23)
    expect(plan.endDate).toBe("2026-12-23");
    expect(plan.endDate).toBe(addDays("2026-10-01", 83));
    expect(plan.month).toBe("2026-10");
    expect(plan.timezone).toBe("America/Mexico_City");
  });

  it("backfills the competitor cap when the event track is short on supply", async () => {
    const calls: LlmRequest[] = [];
    // Event track returns only 20 (target is 30) -> competitor cap rises to 40.
    const eventItems = Array.from({ length: 20 }, (_, i) => item(addDays("2026-10-01", i), "event"));
    const compItems = Array.from({ length: 40 }, (_, i) => item(addDays("2026-10-01", 20 + i), "competitor"));
    const gen = new OpenAiPlanGenerator({
      client: sequencedClient([JSON.stringify(eventItems), JSON.stringify(compItems)], calls),
      model: "gpt-6-astra",
      reasoningEffort: "medium",
      evergreenFormats: [],
      channel,
    });

    const plan = await gen.generate(baseRequest());

    const byEvent = plan.slots.filter((s) => s.source === "event").length;
    const byComp = plan.slots.filter((s) => s.source === "competitor").length;
    expect(byEvent).toBe(20);
    expect(byComp).toBe(40);
    expect(plan.slots).toHaveLength(60);
  });

  it("caps each track at its target when the model over-produces", async () => {
    const calls: LlmRequest[] = [];
    const eventItems = Array.from({ length: 35 }, (_, i) => item(addDays("2026-10-01", i), "event"));
    const compItems = Array.from({ length: 35 }, (_, i) => item(addDays("2026-10-01", 40 + i), "competitor"));
    const gen = new OpenAiPlanGenerator({
      client: sequencedClient([JSON.stringify(eventItems), JSON.stringify(compItems)], calls),
      model: "gpt-6-astra",
      reasoningEffort: "medium",
      evergreenFormats: [],
      channel,
    });

    const plan = await gen.generate(baseRequest());

    // Event filled target (30), so competitor cap stays 30; both sliced down.
    expect(plan.slots.filter((s) => s.source === "event")).toHaveLength(30);
    expect(plan.slots.filter((s) => s.source === "competitor")).toHaveLength(30);
  });

  it("passes reasoning effort and returns an empty plan when both calls return junk", async () => {
    const calls: LlmRequest[] = [];
    const gen = new OpenAiPlanGenerator({
      client: sequencedClient(["no json", "still no json"], calls),
      model: "gpt-6-astra",
      reasoningEffort: "medium",
      evergreenFormats: [],
      channel,
    });
    const plan = await gen.generate(baseRequest());
    expect(plan.slots).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0].reasoningEffort).toBe("medium");
  });
});
