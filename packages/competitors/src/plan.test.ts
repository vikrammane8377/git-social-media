import { describe, it, expect } from "vitest";
import { OpenAiPlanGenerator, type Cadence } from "./plan.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { CompetitorInsights } from "./types.js";

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

function mockClient(output: string, captured?: { last?: LlmRequest }): LlmClient {
  return {
    async create(request: LlmRequest) {
      if (captured) captured.last = request;
      return { output_text: output };
    },
  };
}

describe("OpenAiPlanGenerator", () => {
  it("keeps valid slots, drops out-of-window and unknown-source ones, and sorts by date", async () => {
    const output = JSON.stringify([
      { date: "2026-10-05", time: "09:00", format: "Responde a Bix", source: "evergreen", topic: "b", brandFit: 8, hook: "h", why: "w", assets: ["bg"] },
      { date: "2026-10-01", time: "09:00", format: "Speaking dare", source: "event", topic: "a", brandFit: 12, hook: "h", why: "w", assets: [] },
      { date: "2026-12-31", time: "09:00", format: "x", source: "evergreen", topic: "too late", brandFit: 5 },
      { date: "2026-10-03", time: "09:00", format: "y", source: "invalid", topic: "bad source", brandFit: 5 },
    ]);
    const gen = new OpenAiPlanGenerator({ client: mockClient(output), model: "gpt-6-astra", reasoningEffort: "medium", evergreenFormats: ["Responde a Bix series"] });
    const plan = await gen.generate({ startDate: "2026-10-01", planDays: 30, cadence, insights, events: [] });

    expect(plan.slots.map((s) => s.date)).toEqual(["2026-10-01", "2026-10-05"]);
    // brandFit clamped to 0-10
    expect(plan.slots[0].brandFit).toBe(10);
    expect(plan.month).toBe("2026-10");
    expect(plan.endDate).toBe("2026-10-30");
    expect(plan.timezone).toBe("America/Mexico_City");
  });

  it("passes reasoning effort and returns an empty plan when the model returns junk", async () => {
    const captured: { last?: LlmRequest } = {};
    const gen = new OpenAiPlanGenerator({ client: mockClient("no json", captured), model: "gpt-6-astra", reasoningEffort: "medium", evergreenFormats: [] });
    const plan = await gen.generate({ startDate: "2026-10-01", planDays: 30, cadence, insights, events: [] });
    expect(plan.slots).toEqual([]);
    expect(captured.last?.reasoningEffort).toBe("medium");
  });
});
