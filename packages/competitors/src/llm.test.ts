import { describe, it, expect } from "vitest";
import { parseJsonArray, parseJsonObject } from "./llm.js";

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
