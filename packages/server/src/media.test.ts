import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStorage } from "@bix/storage";
import { MediaService, MediaAccessError, parseRange } from "./media.js";

describe("parseRange", () => {
  const size = 100;
  it("returns null for no header", () => {
    expect(parseRange(undefined, size)).toBeNull();
    expect(parseRange(null, size)).toBeNull();
  });
  it("parses a bounded range", () => {
    expect(parseRange("bytes=0-9", size)).toEqual({ start: 0, end: 9 });
  });
  it("parses an open-ended range", () => {
    expect(parseRange("bytes=50-", size)).toEqual({ start: 50, end: 99 });
  });
  it("parses a suffix range", () => {
    expect(parseRange("bytes=-10", size)).toEqual({ start: 90, end: 99 });
  });
  it("clamps end past EOF", () => {
    expect(parseRange("bytes=90-999", size)).toEqual({ start: 90, end: 99 });
  });
  it("rejects malformed and unsatisfiable ranges", () => {
    expect(parseRange("weird", size)).toBe("invalid");
    expect(parseRange("bytes=-", size)).toBe("invalid");
    expect(parseRange("bytes=200-300", size)).toBe("invalid");
    expect(parseRange("bytes=50-10", size)).toBe("invalid");
  });
});

describe("MediaService", () => {
  let base: string;
  let storage: LocalFileStorage;
  let media: MediaService;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bix-media-"));
    storage = new LocalFileStorage(base);
    media = new MediaService(storage);
    storage.write("outputs/reports/r.md", "# hello");
    storage.write("outputs/video/clip.mp4", Buffer.from("0123456789")); // 10 bytes
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("reads a whitelisted report", () => {
    expect(media.readReport("outputs/reports/r.md").text).toBe("# hello");
  });

  it("rejects reports outside outputs/", () => {
    expect(() => media.readReport("secrets/env.md")).toThrow(MediaAccessError);
    expect(() => media.readReport("outputs/x.txt")).toThrow(MediaAccessError);
  });

  it("returns the full file with 200 when no range", () => {
    const res = media.videoRange("outputs/video/clip.mp4", undefined);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("0123456789");
    expect(res.headers["Content-Length"]).toBe("10");
  });

  it("returns a 206 slice for a valid range", () => {
    const res = media.videoRange("outputs/video/clip.mp4", "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("2345");
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    expect(res.headers["Content-Length"]).toBe("4");
  });

  it("returns 416 for an unsatisfiable range", () => {
    const res = media.videoRange("outputs/video/clip.mp4", "bytes=50-60");
    expect(res.status).toBe(416);
    expect(res.headers["Content-Range"]).toBe("bytes */10");
  });

  it("path-guards video keys outside outputs/", () => {
    expect(() => media.videoRange("data/bix.db", undefined)).toThrow(MediaAccessError);
    expect(() => media.videoRange("outputs/video/../../etc/x.mp4", undefined)).toThrow();
  });
});
