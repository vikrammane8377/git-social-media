import { describe, it, expect } from "vitest";
import { OpenAiScriptReviewer } from "./reviewer.js";
import type { LlmClient, LlmRequest } from "./llm.js";
import type { PlanSlotRecord } from "./plan-slot-reader.js";
import type { ScriptDraft } from "./types.js";

function slot(): PlanSlotRecord {
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
    why: "evergreen",
    assets: [],
  };
}

function draft(): ScriptDraft {
  return {
    title: "Coffee dare",
    scenePrompt: "Bix winks in a cafe.",
    dialogue: "Di conmigo: 'A coffee, please.'",
    durationSeconds: 5,
    usedAssets: [],
    neededImages: [],
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
  productFacts: ["No free/unlimited claims.", "Talk with Bix is an Ultra feature."],
});

function verdict(decision: string): string {
  return JSON.stringify({
    decision,
    englishMeaning: "Bix dares you to order a coffee in English.",
    brandVoice: "Witty intent preserved.",
    issues: [],
    productClaims: [],
    coverage: "Script text assessed; no media reviewed.",
    uncertainty: "",
    nextStep: "ready for rendering",
  });
}

describe("OpenAiScriptReviewer", () => {
  it("parses each valid decision", async () => {
    for (const decision of ["PASS", "REVISE", "NEEDS_EVIDENCE"]) {
      const reviewer = new OpenAiScriptReviewer(deps(mockClient(verdict(decision))));
      const result = await reviewer.review(slot(), draft());
      expect(result.decision).toBe(decision);
    }
  });

  it("passes reasoning effort and the product facts into the prompt", async () => {
    const captured: { last?: LlmRequest } = {};
    const reviewer = new OpenAiScriptReviewer(deps(mockClient(verdict("PASS"), captured)));
    await reviewer.review(slot(), draft());
    expect(captured.last?.reasoningEffort).toBe("medium");
    expect(captured.last?.input).toContain("Talk with Bix is an Ultra feature.");
  });

  it("treats an unknown decision as NEEDS_EVIDENCE (never an optimistic pass)", async () => {
    const reviewer = new OpenAiScriptReviewer(deps(mockClient(verdict("PASS WITH CHANGES"))));
    const result = await reviewer.review(slot(), draft());
    expect(result.decision).toBe("NEEDS_EVIDENCE");
  });

  it("treats unparseable output as NEEDS_EVIDENCE", async () => {
    const reviewer = new OpenAiScriptReviewer(deps(mockClient("no json here")));
    const result = await reviewer.review(slot(), draft());
    expect(result.decision).toBe("NEEDS_EVIDENCE");
    expect(result.issues.join(" ")).toMatch(/no parseable/i);
  });
});
