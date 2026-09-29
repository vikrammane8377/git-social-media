import { describe, it, expect } from "vitest";
import { OpenAiTopicScorer } from "./scoring.js";
import type { LlmClient } from "./llm.js";
import type { RawTopic } from "./types.js";

function topic(title: string, date: string): RawTopic {
  return { title, summary: "", date, sourceUrl: "https://x", source: "web" };
}

describe("OpenAiTopicScorer", () => {
  it("aligns scores to indices and clamps brandFit to 0-10", async () => {
    const topics = [topic("A", "2026-10-10"), topic("B", "2026-10-11")];
    const client: LlmClient = {
      create: async () => ({
        output_text: JSON.stringify([
          { index: 0, brandFit: 12, reason: "great", suggestedFormat: "short", postingWindow: { earliest: "2026-10-05", latest: "2026-10-10" } },
          { index: 1, brandFit: -3, reason: "meh", suggestedFormat: "clip" },
          { index: 9, brandFit: 5 }, // out of range -> ignored
        ]),
      }),
    };
    const scorer = new OpenAiTopicScorer({ client, model: "gpt-5.6" });
    const scores = await scorer.score(topics);

    expect(scores.get(0)?.brandFit).toBe(10);
    expect(scores.get(0)?.postingWindow).toEqual({ earliest: "2026-10-05", latest: "2026-10-10" });
    expect(scores.get(1)?.brandFit).toBe(0);
    // Missing posting window falls back to the topic date.
    expect(scores.get(1)?.postingWindow).toEqual({ earliest: "2026-10-11", latest: "2026-10-11" });
    expect(scores.has(9)).toBe(false);
  });

  it("returns an empty map for no topics without calling the model", async () => {
    let called = false;
    const client: LlmClient = { create: async () => { called = true; return { output_text: "[]" }; } };
    const scorer = new OpenAiTopicScorer({ client, model: "gpt-5.6" });
    const scores = await scorer.score([]);
    expect(scores.size).toBe(0);
    expect(called).toBe(false);
  });
});
