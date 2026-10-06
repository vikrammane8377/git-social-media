import { describe, it, expect } from "vitest";
import { OpenAiScriptWriter } from "./writer.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { PlanSlotRecord } from "./plan-slot-reader.js";
import type { ReviewResult } from "./types.js";

function slot(overrides: Partial<PlanSlotRecord> = {}): PlanSlotRecord {
  return {
    id: "2026-10-001",
    month: "2026-10",
    date: "2026-10-01",
    time: "09:00",
    format: "Responde a Bix",
    source: "evergreen",
    topic: "Ordering coffee in English",
    brandFit: 8,
    hook: "Te reto a pedir un café en inglés",
    why: "High-engagement evergreen format",
    assets: ["bix_stand.png"],
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

const deps = (client: LlmClient) => ({
  client,
  model: "gpt-5.6-sol",
  reasoningEffort: "medium" as const,
  productFacts: ["No free/unlimited claims.", "No on-screen text."],
});

describe("OpenAiScriptWriter", () => {
  it("parses the model's JSON into a ScriptDraft", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({
      title: "Coffee dare",
      scenePrompt: "Bix winks in a cafe, vertical frame.",
      dialogue: "Di conmigo: 'A coffee, please.'",
      durationSeconds: 27,
      notes: "LatAm; means 'un café, por favor'.",
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output, captured)));
    const draft = await writer.write(slot());

    expect(draft.title).toBe("Coffee dare");
    expect(draft.scenePrompt).toContain("Bix winks");
    expect(draft.dialogue).toContain("A coffee, please.");
    expect(draft.durationSeconds).toBe(27);
    expect(captured.last?.reasoningEffort).toBe("medium");
    // The writer passes no web-search tool.
    expect(captured.last?.tools).toBeUndefined();
    // The slot's topic reaches the prompt.
    expect(captured.last?.input).toContain("Ordering coffee in English");
  });

  it("handles malformed JSON by returning an empty draft carrying the raw text", async () => {
    const writer = new OpenAiScriptWriter(deps(mockClient("sorry, I can't do that")));
    const draft = await writer.write(slot());
    expect(draft.scenePrompt).toBe("");
    expect(draft.dialogue).toBe("");
    expect(draft.durationSeconds).toBe(0);
    expect(draft.notes).toContain("no parseable JSON");
  });

  it("clamps a positive durationSeconds into the 25-30 second range", async () => {
    const low = new OpenAiScriptWriter(
      deps(mockClient(JSON.stringify({ scenePrompt: "s", dialogue: "d", durationSeconds: 5 }))),
    );
    expect((await low.write(slot())).durationSeconds).toBe(25);

    const high = new OpenAiScriptWriter(
      deps(mockClient(JSON.stringify({ scenePrompt: "s", dialogue: "d", durationSeconds: 90 }))),
    );
    expect((await high.write(slot())).durationSeconds).toBe(30);

    const inRange = new OpenAiScriptWriter(
      deps(mockClient(JSON.stringify({ scenePrompt: "s", dialogue: "d", durationSeconds: 28 }))),
    );
    expect((await inRange.write(slot())).durationSeconds).toBe(28);
  });

  it("revise re-prompts with the reviewer's issues and parses a new draft", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({
      scenePrompt: "Bix shrugs playfully.",
      dialogue: "Practica inglés con Bix a tu ritmo.",
      durationSeconds: 5,
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output, captured)));
    const review: ReviewResult = {
      decision: "REVISE",
      englishMeaning: "",
      brandVoice: "",
      issues: ["HIGH / claim: remove the 'fluent in 7 days' promise."],
      productClaims: [],
      coverage: "",
      uncertainty: "",
      nextStep: "revise text",
    };
    const prev = {
      scenePrompt: "old",
      dialogue: "Habla inglés en 7 días",
      durationSeconds: 5,
      usedAssets: [],
      neededImages: [],
    };
    const draft = await writer.revise(slot(), prev, review);

    expect(draft.dialogue).toContain("a tu ritmo");
    expect(captured.last?.input).toContain("fluent in 7 days");
  });

  it("keeps only usedAssets keys that exist in the provided library", async () => {
    const output = JSON.stringify({
      scenePrompt: "Bix winks in a cafe, vertical frame.",
      dialogue: "Di conmigo: 'A coffee, please.'",
      durationSeconds: 5,
      usedAssets: ["assets/uploads/real.png", "assets/uploads/ghost.png"],
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output)));
    const draft = await writer.write(slot(), [
      { key: "assets/uploads/real.png", filename: "real.png", tags: ["bix"], description: "", analysis: "" },
    ]);

    expect(draft.usedAssets).toEqual(["assets/uploads/real.png"]);
  });

  it("lists the asset library (with vision analysis) in the write prompt", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({
      scenePrompt: "Bix winks.",
      dialogue: "Hi.",
      durationSeconds: 5,
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output, captured)));
    await writer.write(slot(), [
      {
        key: "assets/uploads/real.png",
        filename: "real.png",
        tags: ["cafe"],
        description: "cafe shot",
        analysis: "A cosy cafe backdrop that suits Bix's playful coffee lessons.",
      },
    ]);

    expect(captured.last?.input).toContain("assets/uploads/real.png");
    expect(captured.last?.input).toContain("cafe");
    expect(captured.last?.input).toContain("cosy cafe backdrop");
  });

  it("trims a long asset analysis so the prompt stays compact", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({ scenePrompt: "Bix winks.", dialogue: "Hi.", durationSeconds: 5 });
    const writer = new OpenAiScriptWriter(deps(mockClient(output, captured)));
    const longAnalysis = "A ".repeat(200).trim(); // ~400 chars, well over the cap
    await writer.write(slot(), [
      { key: "assets/uploads/real.png", filename: "real.png", tags: [], description: "", analysis: longAnalysis },
    ]);

    const line = (captured.last?.input ?? "")
      .split("\n")
      .find((l) => l.includes("assets/uploads/real.png"));
    expect(line).toBeDefined();
    // The full analysis is not replayed verbatim; it is truncated with an ellipsis.
    expect(line).not.toContain(longAnalysis);
    expect(line).toContain("…");
  });

  it("parses neededImages the model returns, keeping prompt+purpose", async () => {
    const output = JSON.stringify({
      scenePrompt: "Bix winks.",
      dialogue: "Hi.",
      durationSeconds: 5,
      neededImages: [
        { prompt: "Bix in a santa hat by a tree.", purpose: "christmas hero still" },
      ],
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output)));
    const draft = await writer.write(slot());

    expect(draft.neededImages).toEqual([
      { prompt: "Bix in a santa hat by a tree.", purpose: "christmas hero still" },
    ]);
  });

  it("caps neededImages at MAX_NEEDED_IMAGES and drops malformed entries", async () => {
    const output = JSON.stringify({
      scenePrompt: "Bix winks.",
      dialogue: "Hi.",
      durationSeconds: 5,
      neededImages: [
        { prompt: "one", purpose: "a" },
        { prompt: "", purpose: "missing prompt" }, // dropped
        { prompt: "no purpose" }, // dropped
        { prompt: "two", purpose: "b" },
        { prompt: "three", purpose: "c" }, // over the cap
      ],
    });
    const writer = new OpenAiScriptWriter(deps(mockClient(output)));
    const draft = await writer.write(slot());

    expect(draft.neededImages).toEqual([
      { prompt: "one", purpose: "a" },
      { prompt: "two", purpose: "b" },
    ]);
  });

  it("defaults neededImages to [] when the model omits it", async () => {
    const output = JSON.stringify({ scenePrompt: "Bix winks.", dialogue: "Hi.", durationSeconds: 5 });
    const writer = new OpenAiScriptWriter(deps(mockClient(output)));
    const draft = await writer.write(slot());

    expect(draft.neededImages).toEqual([]);
  });

  it("invites image requests only when no library fits (prompt wording)", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({ scenePrompt: "Bix winks.", dialogue: "Hi.", durationSeconds: 5 });
    const writer = new OpenAiScriptWriter(deps(mockClient(output, captured)));
    await writer.write(slot());

    expect(captured.last?.input).toContain("neededImages");
  });
});
