import { describe, it, expect } from "vitest";
import { composeVideoPrompt } from "./prompt.js";
import type { ScriptDraft } from "./types.js";

function draft(overrides: Partial<ScriptDraft> = {}): ScriptDraft {
  return {
    title: "Test",
    scenePrompt: "Bix leans into the camera in a bright vertical frame, grinning.",
    dialogue: "¿Listo para practicar tu inglés? Say it with me: 'I'm ready!'",
    durationSeconds: 5,
    usedAssets: [],
    neededImages: [],
    ...overrides,
  };
}

describe("composeVideoPrompt", () => {
  it("produces a two-paragraph shape with the dialogue embedded for wan", () => {
    const prompt = composeVideoPrompt(draft(), "wan");
    const paragraphs = prompt.split("\n\n");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain("Bix leans into the camera");
    expect(paragraphs[1]).toContain("I'm ready!");
  });

  it("embeds the dialogue for veo and kling too", () => {
    for (const provider of ["veo", "kling"]) {
      const prompt = composeVideoPrompt(draft(), provider);
      expect(prompt).toContain("¿Listo para practicar tu inglés?");
    }
  });

  it("emits scene only (no embedded dialogue) for avatar", () => {
    const prompt = composeVideoPrompt(draft(), "avatar");
    expect(prompt).toBe("Bix leans into the camera in a bright vertical frame, grinning.");
    expect(prompt).not.toContain("I'm ready!");
  });

  it("is deterministic for the same draft", () => {
    const a = composeVideoPrompt(draft(), "wan");
    const b = composeVideoPrompt(draft(), "wan");
    expect(a).toBe(b);
  });
});
