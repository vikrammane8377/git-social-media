import { describe, it, expect } from "vitest";
import { OpenAiCompetitorAnalyst } from "./insights.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { CompetitorVideo } from "./types.js";

function video(overrides: Partial<CompetitorVideo> = {}): CompetitorVideo {
  return {
    videoId: "v1",
    channelId: "UC1",
    channelName: "Duolingo",
    title: "Test short",
    publishedAt: "2026-09-01T00:00:00Z",
    durationSeconds: 30,
    weight: 1,
    ...overrides,
  };
}

function mockClient(output: string, captured?: { last?: LlmRequest }): LlmClient {
  return {
    async create(request: LlmRequest) {
      if (captured) captured.last = request;
      return { output_text: output };
    },
  };
}

describe("OpenAiCompetitorAnalyst", () => {
  it("returns a note and does not call the model when there are no videos", async () => {
    const captured: { last?: LlmRequest } = {};
    const analyst = new OpenAiCompetitorAnalyst({ client: mockClient("[]", captured), model: "gpt-6-astra", reasoningEffort: "medium" });
    const insights = await analyst.summarise([]);
    expect(insights.formats).toEqual([]);
    expect(insights.notes.length).toBeGreaterThan(0);
    expect(captured.last).toBeUndefined();
  });

  it("parses the model's object and passes web_search + reasoning effort", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({
      formats: ["talking head", "skit"],
      hooks: ["question opener"],
      lengths: "15-30s",
      postingRhythm: "daily",
      themes: ["false friends"],
      ctas: ["download the app"],
      notes: ["Public counts cannot distinguish organic vs paid reach."],
    });
    const analyst = new OpenAiCompetitorAnalyst({ client: mockClient(output, captured), model: "gpt-6-astra", reasoningEffort: "medium" });
    const insights = await analyst.summarise([video()]);

    expect(insights.formats).toEqual(["talking head", "skit"]);
    expect(insights.ctas).toEqual(["download the app"]);
    expect(captured.last?.tools).toEqual([{ type: "web_search" }]);
    expect(captured.last?.reasoningEffort).toBe("medium");
  });

  it("adds the reach caveat when the model omits notes", async () => {
    const output = JSON.stringify({ formats: ["skit"] });
    const analyst = new OpenAiCompetitorAnalyst({ client: mockClient(output), model: "gpt-6-astra", reasoningEffort: "medium" });
    const insights = await analyst.summarise([video()]);
    expect(insights.notes.join(" ")).toMatch(/organic vs paid/i);
  });
});
