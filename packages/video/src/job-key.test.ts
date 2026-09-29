import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeJobKey, type JobKeyInput } from "./job-key.js";

describe("computeJobKey", () => {
  let dir: string;
  let ref: string;

  const base = (): JobKeyInput => ({
    endpoint: "ep",
    prompt: "hello bix",
    resolution: "720p",
    aspectRatio: "9:16",
    duration: 5,
    generateAudio: true,
    refImagePaths: [ref],
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bix-key-"));
    ref = join(dir, "ref.png");
    writeFileSync(ref, "image-bytes-v1");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is stable for identical inputs", () => {
    expect(computeJobKey(base())).toBe(computeJobKey(base()));
  });

  it("changes when the prompt changes", () => {
    expect(computeJobKey(base())).not.toBe(
      computeJobKey({ ...base(), prompt: "different" }),
    );
  });

  it("changes when a parameter changes", () => {
    expect(computeJobKey(base())).not.toBe(
      computeJobKey({ ...base(), resolution: "1080p" }),
    );
  });

  it("changes when the reference image content changes", () => {
    const first = computeJobKey(base());
    writeFileSync(ref, "image-bytes-v2");
    expect(computeJobKey(base())).not.toBe(first);
  });
});
