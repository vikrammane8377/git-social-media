import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileStorage } from "./files.js";

describe("LocalFileStorage", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bix-store-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("writes and reads a file, creating nested dirs", () => {
    const store = new LocalFileStorage(base);
    store.write("outputs/video/clip-01.txt", "hello bix");
    expect(store.exists("outputs/video/clip-01.txt")).toBe(true);
    expect(store.read("outputs/video/clip-01.txt").toString()).toBe("hello bix");
  });

  it("deletes files", () => {
    const store = new LocalFileStorage(base);
    store.write("a.txt", "x");
    store.delete("a.txt");
    expect(store.exists("a.txt")).toBe(false);
  });

  it("rejects absolute keys", () => {
    const store = new LocalFileStorage(base);
    expect(() => store.write("/etc/passwd", "x")).toThrowError(/relative/);
  });

  it("rejects path traversal outside the base dir", () => {
    const store = new LocalFileStorage(base);
    expect(() => store.write("../escape.txt", "x")).toThrowError(/escapes base/);
  });
});
