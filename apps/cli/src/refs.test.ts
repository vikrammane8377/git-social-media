import { describe, it, expect } from "vitest";
import { selectRefs, pickThumbnailKey, mimeFromKey, DEFAULT_REF } from "./refs.js";

describe("selectRefs", () => {
  it("prefers explicit --ref over everything else", () => {
    expect(selectRefs(["a.png"], ["used.png"], ["gen.png"])).toEqual(["a.png"]);
  });

  it("combines writer-chosen assets with generated ones when no explicit ref", () => {
    expect(selectRefs([], ["used.png"], ["gen.png"])).toEqual(["used.png", "gen.png"]);
  });

  it("uses generated images alone when the writer chose none", () => {
    expect(selectRefs([], [], ["gen1.png", "gen2.png"])).toEqual(["gen1.png", "gen2.png"]);
  });

  it("falls back to the default stand image when nothing is available", () => {
    expect(selectRefs([], [], [])).toEqual([DEFAULT_REF]);
  });
});

describe("pickThumbnailKey", () => {
  it("prefers the first generated still", () => {
    expect(pickThumbnailKey(["gen.png"], ["used.png"])).toBe("gen.png");
  });

  it("falls back to the first ref when nothing was generated", () => {
    expect(pickThumbnailKey([], ["used.png", "other.png"])).toBe("used.png");
  });

  it("is undefined when there is nothing to use", () => {
    expect(pickThumbnailKey([], [])).toBeUndefined();
  });
});

describe("mimeFromKey", () => {
  it("maps known image extensions", () => {
    expect(mimeFromKey("a/b.png")).toBe("image/png");
    expect(mimeFromKey("a.JPG")).toBe("image/jpeg");
    expect(mimeFromKey("a.jpeg")).toBe("image/jpeg");
    expect(mimeFromKey("a.webp")).toBe("image/webp");
    expect(mimeFromKey("a.gif")).toBe("image/gif");
  });

  it("defaults to png for unknown or missing extensions", () => {
    expect(mimeFromKey("noext")).toBe("image/png");
    expect(mimeFromKey("a.bmp")).toBe("image/png");
  });
});
