import { describe, it, expect } from "vitest";
import { YouTubeDataClient, parseIsoDuration, type FetchLike } from "./youtube.js";

describe("parseIsoDuration", () => {
  it("parses seconds, minutes and hours", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT2M")).toBe(120);
  });

  it("returns 0 for unparseable input", () => {
    expect(parseIsoDuration("nonsense")).toBe(0);
    expect(parseIsoDuration("")).toBe(0);
  });
});

/** Build a FetchLike that serves canned JSON keyed by a substring of the URL. */
function mockFetch(routes: Record<string, unknown>): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url: string) => {
    urls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
    }
    return { ok: true, status: 200, json: async () => routes[key], text: async () => "" };
  };
  return { fetch, urls };
}

describe("YouTubeDataClient.resolveChannel", () => {
  it("resolves a handle to its uploads playlist", async () => {
    const { fetch, urls } = mockFetch({
      "/channels": {
        items: [
          {
            id: "UC123",
            snippet: { title: "Duolingo Spanish" },
            contentDetails: { relatedPlaylists: { uploads: "UU123" } },
            statistics: { subscriberCount: "1000", videoCount: "50" },
          },
        ],
      },
    });
    const client = new YouTubeDataClient({ apiKey: "k", fetch });
    const resolved = await client.resolveChannel({ handle: "@duolingospanish", name: "Duolingo Spanish", weight: 1 });

    expect(resolved.channelId).toBe("UC123");
    expect(resolved.uploadsPlaylistId).toBe("UU123");
    expect(resolved.subscriberCount).toBe(1000);
    // handle passed through forHandle with a leading @ preserved
    expect(urls[0]).toContain("forHandle=%40duolingospanish");
    expect(urls[0]).toContain("key=k");
  });

  it("throws when no channel is found", async () => {
    const { fetch } = mockFetch({ "/channels": { items: [] } });
    const client = new YouTubeDataClient({ apiKey: "k", fetch });
    await expect(client.resolveChannel({ id: "UCmissing", name: "X", weight: 1 })).rejects.toThrow(/No channel/);
  });
});

describe("YouTubeDataClient.recentShorts", () => {
  it("pulls upload ids then video details and keeps only Shorts", async () => {
    const { fetch } = mockFetch({
      "/playlistItems": {
        items: [
          { contentDetails: { videoId: "v1" } },
          { contentDetails: { videoId: "v2" } },
        ],
      },
      "/videos": {
        items: [
          {
            id: "v1",
            snippet: { title: "Short one", publishedAt: "2026-09-01T00:00:00Z", channelTitle: "Duolingo" },
            contentDetails: { duration: "PT30S" },
            statistics: { viewCount: "500", likeCount: "40", commentCount: "5" },
          },
          {
            id: "v2",
            snippet: { title: "Long one", publishedAt: "2026-09-02T00:00:00Z", channelTitle: "Duolingo" },
            contentDetails: { duration: "PT5M" },
            statistics: { viewCount: "10" },
          },
        ],
      },
    });
    const client = new YouTubeDataClient({ apiKey: "k", fetch });
    const shorts = await client.recentShorts(
      { channelId: "UC123", title: "Duolingo", uploadsPlaylistId: "UU123" },
      "Duolingo Spanish",
      1,
      30,
      180,
    );

    expect(shorts).toHaveLength(1);
    expect(shorts[0].videoId).toBe("v1");
    expect(shorts[0].durationSeconds).toBe(30);
    expect(shorts[0].viewCount).toBe(500);
    expect(shorts[0].weight).toBe(1);
  });
});
