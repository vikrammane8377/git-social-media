import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { YouTubeUploadStore } from "./upload-store.js";

function newStore(): YouTubeUploadStore {
  const store = new YouTubeUploadStore(new SqliteDatabase(":memory:"));
  store.init();
  return store;
}

describe("YouTubeUploadStore", () => {
  it("creates and reads back an upload record", () => {
    const store = newStore();
    store.create({
      id: "outputs/video/clip.mp4",
      slotId: "2026-10-001",
      title: "Test",
      privacy: "unlisted",
      youtubeVideoId: null,
      status: "SUBMITTED",
      error: null,
    });

    const got = store.get("outputs/video/clip.mp4");
    expect(got?.status).toBe("SUBMITTED");
    expect(got?.slotId).toBe("2026-10-001");
    expect(got?.youtubeVideoId).toBeNull();
  });

  it("returns undefined for an unknown key", () => {
    expect(newStore().get("nope")).toBeUndefined();
  });

  it("records completion so a rerun can detect and skip a double-post", () => {
    const store = newStore();
    const key = "outputs/video/clip.mp4";
    store.create({
      id: key,
      slotId: "s1",
      title: "Test",
      privacy: "public",
      youtubeVideoId: null,
      status: "SUBMITTED",
      error: null,
    });

    store.update(key, { status: "COMPLETED", youtubeVideoId: "VID123" });

    const got = store.get(key);
    expect(got?.status).toBe("COMPLETED");
    expect(got?.youtubeVideoId).toBe("VID123");

    // The idempotency guard the CLI uses: a COMPLETED row with a video id exists.
    const completed = got?.status === "COMPLETED" && Boolean(got?.youtubeVideoId);
    expect(completed).toBe(true);
  });

  it("records a failure with its error message", () => {
    const store = newStore();
    const key = "outputs/video/clip.mp4";
    store.create({
      id: key,
      slotId: "s1",
      title: "Test",
      privacy: "public",
      youtubeVideoId: null,
      status: "SUBMITTED",
      error: null,
    });
    store.update(key, { status: "FAILED", error: "quota exceeded" });
    const got = store.get(key);
    expect(got?.status).toBe("FAILED");
    expect(got?.error).toBe("quota exceeded");
  });
});
