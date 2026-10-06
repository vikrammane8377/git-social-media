import { describe, it, expect } from "vitest";
import { runScriptWriter, type Writer, type Reviewer } from "./run.js";
import type { PlanSlotReader, PlanSlotRecord } from "./plan-slot-reader.js";
import type { ScriptStore } from "./store.js";
import type { ReviewResult, ScriptDraft, ScriptResult } from "./types.js";

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
    hook: "hook",
    why: "why",
    assets: [],
  };
}

function fakeReader(record: PlanSlotRecord | undefined): PlanSlotReader {
  return { getById: () => record } as unknown as PlanSlotReader;
}

function fakeStore(saved: ScriptResult[]): ScriptStore {
  return { save: (r: ScriptResult) => saved.push(r) } as unknown as ScriptStore;
}

const baseDraft: ScriptDraft = {
  scenePrompt: "Bix winks in a cafe.",
  dialogue: "A coffee, please.",
  durationSeconds: 5,
  usedAssets: [],
  neededImages: [],
};

function verdict(decision: ReviewResult["decision"]): ReviewResult {
  return {
    decision,
    englishMeaning: "",
    brandVoice: "",
    issues: decision === "REVISE" ? ["fix the claim"] : [],
    productClaims: [],
    coverage: "",
    uncertainty: "",
    nextStep: "",
  };
}

/** A writer that returns the same draft for write and revise, counting calls. */
function countingWriter(counter: { writes: number; revisions: number }): Writer {
  return {
    async write() {
      counter.writes += 1;
      return baseDraft;
    },
    async revise() {
      counter.revisions += 1;
      return baseDraft;
    },
  };
}

/** A reviewer that yields the decisions in order, repeating the last. */
function scriptedReviewer(decisions: ReviewResult["decision"][]): Reviewer {
  let i = 0;
  return {
    async review() {
      const d = decisions[Math.min(i, decisions.length - 1)];
      i += 1;
      return verdict(d);
    },
  };
}

describe("runScriptWriter", () => {
  it("PASS on the first try does zero revisions", async () => {
    const counter = { writes: 0, revisions: 0 };
    const saved: ScriptResult[] = [];
    const result = await runScriptWriter({
      reader: fakeReader(slot()),
      writer: countingWriter(counter),
      reviewer: scriptedReviewer(["PASS"]),
      store: fakeStore(saved),
      maxRevisions: 2,
      provider: "wan",
      slotId: "2026-10-001",
    });

    expect(result.review.decision).toBe("PASS");
    expect(result.revisions).toBe(0);
    expect(counter.revisions).toBe(0);
    expect(result.videoPrompt).toContain("A coffee, please.");
    expect(saved).toHaveLength(1);
  });

  it("REVISE then PASS does exactly one revision", async () => {
    const counter = { writes: 0, revisions: 0 };
    const saved: ScriptResult[] = [];
    const result = await runScriptWriter({
      reader: fakeReader(slot()),
      writer: countingWriter(counter),
      reviewer: scriptedReviewer(["REVISE", "PASS"]),
      store: fakeStore(saved),
      maxRevisions: 2,
      provider: "wan",
      slotId: "2026-10-001",
    });

    expect(result.review.decision).toBe("PASS");
    expect(result.revisions).toBe(1);
    expect(counter.revisions).toBe(1);
  });

  it("stops at maxRevisions when REVISE never clears, reporting not-ready", async () => {
    const counter = { writes: 0, revisions: 0 };
    const saved: ScriptResult[] = [];
    const result = await runScriptWriter({
      reader: fakeReader(slot()),
      writer: countingWriter(counter),
      reviewer: scriptedReviewer(["REVISE", "REVISE", "REVISE"]),
      store: fakeStore(saved),
      maxRevisions: 2,
      provider: "wan",
      slotId: "2026-10-001",
    });

    expect(result.review.decision).toBe("REVISE");
    expect(result.revisions).toBe(2);
    expect(counter.revisions).toBe(2);
    // Still persisted (so the report/row exists), just not ready to generate.
    expect(saved).toHaveLength(1);
  });

  it("throws when the slot id is missing", async () => {
    await expect(
      runScriptWriter({
        reader: fakeReader(undefined),
        writer: countingWriter({ writes: 0, revisions: 0 }),
        reviewer: scriptedReviewer(["PASS"]),
        store: fakeStore([]),
        maxRevisions: 2,
        provider: "wan",
        slotId: "missing",
      }),
    ).rejects.toThrow(/No plan slot found/);
  });
});
