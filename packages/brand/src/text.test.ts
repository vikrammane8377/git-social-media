import { describe, it, expect } from "vitest";
import { wrapTitle, escapeDrawText } from "./text.js";

describe("wrapTitle", () => {
  it("returns no lines for an empty/whitespace title", () => {
    expect(wrapTitle("", { maxCharsPerLine: 20, maxLines: 3 })).toEqual([]);
    expect(wrapTitle("   ", { maxCharsPerLine: 20, maxLines: 3 })).toEqual([]);
  });

  it("keeps a short title on a single line", () => {
    expect(wrapTitle("Coffee dare", { maxCharsPerLine: 20, maxLines: 3 })).toEqual(["Coffee dare"]);
  });

  it("wraps on word boundaries without exceeding the soft limit", () => {
    const lines = wrapTitle("Order a coffee in English today", { maxCharsPerLine: 12, maxLines: 4 });
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
    expect(lines.join(" ")).toBe("Order a coffee in English today");
  });

  it("never splits a single long word", () => {
    const lines = wrapTitle("Supercalifragilistic word", { maxCharsPerLine: 10, maxLines: 3 });
    expect(lines[0]).toBe("Supercalifragilistic");
  });

  it("ellipsises the last line when the title overflows maxLines", () => {
    const lines = wrapTitle("one two three four five six seven eight", {
      maxCharsPerLine: 7,
      maxLines: 2,
    });
    expect(lines.length).toBe(2);
    expect(lines[lines.length - 1].endsWith("…")).toBe(true);
  });
});

describe("escapeDrawText", () => {
  it("escapes backslashes and percents", () => {
    expect(escapeDrawText("100%")).toBe("100\\%");
    expect(escapeDrawText("a\\b")).toBe("a\\\\b");
  });

  it("escapes single quotes for a single-quoted filtergraph value", () => {
    expect(escapeDrawText("it's")).toBe("it'\\''s");
  });

  it("leaves colons and newlines intact (safe inside single quotes)", () => {
    expect(escapeDrawText("a:b")).toBe("a:b");
    expect(escapeDrawText("line1\nline2")).toBe("line1\nline2");
  });
});
