import { describe, it, expect } from "vitest";
import { slotToMetadata, DEFAULT_CATEGORY_ID, type MetadataSlot } from "./metadata.js";

const baseSlot: MetadataSlot = {
  topic: "Cómo pedir un café en inglés",
  hook: "¿Sabes pedir un café sin trabarte?",
  why: "Alta intención de aprendizaje para viajeros.",
  format: "short",
  source: "competitor",
};

describe("slotToMetadata", () => {
  it("derives title from the hook, description from topic/hook/why + footer", () => {
    const md = slotToMetadata(baseSlot);
    expect(md.title).toBe(baseSlot.hook);
    expect(md.description).toContain(baseSlot.topic);
    expect(md.description).toContain(baseSlot.hook);
    expect(md.description).toContain(baseSlot.why);
    expect(md.description).toContain("Bix");
  });

  it("falls back to topic when there is no hook", () => {
    const md = slotToMetadata({ ...baseSlot, hook: "" });
    expect(md.title).toBe(baseSlot.topic);
  });

  it("defaults category to Education, privacy to public, synthetic disclosure to true", () => {
    const md = slotToMetadata(baseSlot);
    expect(md.categoryId).toBe(DEFAULT_CATEGORY_ID);
    expect(md.privacyStatus).toBe("public");
    expect(md.containsSyntheticMedia).toBe(true);
  });

  it("builds tags from format, source and topic words, de-duped", () => {
    const md = slotToMetadata({ ...baseSlot, topic: "café café inglés" });
    expect(md.tags).toContain("short");
    expect(md.tags).toContain("competitor");
    expect(md.tags).toContain("café");
    // "café" appears twice in the topic but must be de-duped.
    expect(md.tags.filter((t) => t === "café")).toHaveLength(1);
  });

  it("clamps the title to 100 characters", () => {
    const md = slotToMetadata({ ...baseSlot, hook: "a".repeat(250) });
    expect(md.title).toHaveLength(100);
  });

  it("clamps the description to 5000 characters", () => {
    const md = slotToMetadata(baseSlot, { description: "d".repeat(6000) });
    expect(md.description).toHaveLength(5000);
  });

  it("clamps total tag length to 500 characters", () => {
    const many = Array.from({ length: 100 }, (_, i) => `tag${i}-${"x".repeat(20)}`);
    const md = slotToMetadata(baseSlot, { tags: many });
    const total = md.tags.reduce((n, t) => n + t.length, 0) + Math.max(0, md.tags.length - 1);
    expect(total).toBeLessThanOrEqual(500);
    expect(md.tags.length).toBeLessThan(many.length);
  });

  it("applies overrides over slot-derived values", () => {
    const md = slotToMetadata(baseSlot, {
      title: "Custom title",
      tags: ["one", "two"],
      categoryId: "22",
      privacyStatus: "unlisted",
      containsSyntheticMedia: false,
    });
    expect(md.title).toBe("Custom title");
    expect(md.tags).toEqual(["one", "two"]);
    expect(md.categoryId).toBe("22");
    expect(md.privacyStatus).toBe("unlisted");
    expect(md.containsSyntheticMedia).toBe(false);
  });
});
