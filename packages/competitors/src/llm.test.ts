import { describe, it, expect } from "vitest";
import {
  parseJsonArray,
  parseJsonObject,
  computeCost,
  UsageTrackingClient,
  type LlmClient,
  type LlmRequest,
} from "./llm.js";

describe("parseJsonArray", () => {
  it("parses a plain array", () => {
    expect(parseJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("parses a fenced array with prose around it", () => {
    const text = "Here you go:\n```json\n[1, 2, 3]\n```\nthanks";
    expect(parseJsonArray(text)).toEqual([1, 2, 3]);
  });

  it("returns [] when nothing parseable is found", () => {
    expect(parseJsonArray("no json here")).toEqual([]);
    expect(parseJsonArray('{"not":"an array"}')).toEqual([]);
  });
});

describe("parseJsonObject", () => {
  it("parses a fenced object", () => {
    const text = "```json\n{ \"formats\": [\"a\"] }\n```";
    expect(parseJsonObject(text)).toEqual({ formats: ["a"] });
  });

  it("returns undefined for an array or junk", () => {
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("nope")).toBeUndefined();
  });
});

describe("computeCost", () => {
  it("prices tokens at the given per-million rates", () => {
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, calls: 2, webSearchCalls: 1 },
      { inputPerMillion: 10, outputPerMillion: 50 },
    );
    expect(cost.inputCost).toBeCloseTo(10, 6);
    expect(cost.outputCost).toBeCloseTo(25, 6);
    expect(cost.total).toBeCloseTo(35, 6);
    expect(cost.calls).toBe(2);
    expect(cost.webSearchCalls).toBe(1);
  });
});

describe("UsageTrackingClient", () => {
  function stub(usage?: { inputTokens: number; outputTokens: number }): LlmClient {
    return {
      async create(_request: LlmRequest) {
        return { output_text: "{}", usage };
      },
    };
  }

  it("accumulates tokens and counts web-search calls", async () => {
    const tracker = new UsageTrackingClient(stub({ inputTokens: 100, outputTokens: 40 }));
    await tracker.create({ model: "m", input: "a", tools: [{ type: "web_search" }] });
    await tracker.create({ model: "m", input: "b" });
    const totals = tracker.totals();
    expect(totals.inputTokens).toBe(200);
    expect(totals.outputTokens).toBe(80);
    expect(totals.calls).toBe(2);
    expect(totals.webSearchCalls).toBe(1);
  });

  it("reports zero tokens honestly when the provider omits usage", async () => {
    const tracker = new UsageTrackingClient(stub(undefined));
    await tracker.create({ model: "m", input: "a" });
    const totals = tracker.totals();
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.calls).toBe(1);
  });
});
