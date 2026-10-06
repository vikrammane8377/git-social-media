import { describe, it, expect } from "vitest";
import type { ChannelUpload } from "@bix/youtube";
import { pickReconciledVideoId } from "./youtube.js";

const started = "2026-10-01T13:32:44Z";

function upload(partial: Partial<ChannelUpload>): ChannelUpload {
  return {
    videoId: "V",
    title: "T",
    publishedAt: "2026-10-01T13:44:00Z",
    privacy: "unlisted",
    ...partial,
  };
}

describe("pickReconciledVideoId", () => {
  it("adopts the video whose title matches and was published after the attempt began", () => {
    const uploads = [
      upload({ videoId: "OTHER", title: "Different title" }),
      upload({ videoId: "MATCH", title: "Liverpool goal", publishedAt: "2026-10-01T13:44:00Z" }),
    ];
    expect(pickReconciledVideoId(uploads, "Liverpool goal", started)).toBe("MATCH");
  });

  it("returns null when no title matches", () => {
    const uploads = [upload({ videoId: "A", title: "Nope" })];
    expect(pickReconciledVideoId(uploads, "Wanted", started)).toBeNull();
  });

  it("ignores a same-title video published well before the attempt (duplicate-title safety)", () => {
    const uploads = [
      // Same title but from a previous day — must NOT be adopted.
      upload({ videoId: "OLD", title: "Repeat", publishedAt: "2026-09-30T14:15:00Z" }),
    ];
    expect(pickReconciledVideoId(uploads, "Repeat", started)).toBeNull();
  });

  it("picks the newest among several same-title matches", () => {
    const uploads = [
      upload({ videoId: "EARLIER", title: "Repeat", publishedAt: "2026-10-01T13:40:00Z" }),
      upload({ videoId: "LATER", title: "Repeat", publishedAt: "2026-10-01T13:50:00Z" }),
    ];
    expect(pickReconciledVideoId(uploads, "Repeat", started)).toBe("LATER");
  });

  it("tolerates small clock skew via the slack window", () => {
    const uploads = [
      // Published 5 minutes before the recorded attempt start — within slack.
      upload({ videoId: "SKEW", title: "Skewed", publishedAt: "2026-10-01T13:27:44Z" }),
    ];
    expect(pickReconciledVideoId(uploads, "Skewed", started)).toBe("SKEW");
  });

  it("still matches when timestamps are unparseable (falls back to title only)", () => {
    const uploads = [upload({ videoId: "NOTIME", title: "Timeless", publishedAt: "" })];
    expect(pickReconciledVideoId(uploads, "Timeless", "not-a-date")).toBe("NOTIME");
  });
});
