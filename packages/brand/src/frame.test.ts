import { describe, it, expect } from "vitest";
import { buildLastFrameArgs } from "./frame.js";

describe("buildLastFrameArgs", () => {
  it("seeks just before the end and writes a single updated PNG", () => {
    const args = buildLastFrameArgs({ videoPath: "/tmp/clip.mp4", outPath: "/tmp/last.png" });
    // Seek relative to end-of-file, then grab exactly one frame.
    const sseof = args.indexOf("-sseof");
    expect(sseof).toBeGreaterThanOrEqual(0);
    expect(args[sseof + 1]).toBe("-0.2");
    // -sseof must precede the input it applies to.
    expect(sseof).toBeLessThan(args.indexOf("-i"));
    expect(args).toContain("/tmp/clip.mp4");
    expect(args).toContain("-frames:v");
    expect(args).toContain("-update");
    expect(args[args.length - 1]).toBe("/tmp/last.png");
  });
});
