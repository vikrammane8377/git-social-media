import { describe, it, expect } from "vitest";
import { runCompetitorScan, type EventsReader } from "./scan.js";
import type { YouTubeClient } from "./youtube.js";
import type { Cadence } from "./plan.js";
import type {
  ChannelConfig,
  CompetitorInsights,
  CompetitorVideo,
  ContentPlan,
  ResolvedChannel,
} from "./types.js";

const cadence: Cadence = {
  postsPerWeek: 5,
  timezone: "America/Mexico_City",
  postingTime: "09:00",
  formatMix: { "Responde a Bix": 1 },
};

const emptyInsights: CompetitorInsights = {
  formats: [],
  hooks: [],
  lengths: "",
  postingRhythm: "",
  themes: [],
  ctas: [],
  notes: [],
};

/** A YouTube client that resolves one channel and throws for another. */
function fakeYouTube(): YouTubeClient {
  return {
    async resolveChannel(channel: ChannelConfig): Promise<ResolvedChannel> {
      if (channel.name === "Broken") throw new Error("quota exceeded");
      return { channelId: "UC1", title: channel.name, uploadsPlaylistId: "UU1" };
    },
    async recentShorts(channel: ResolvedChannel, channelName: string, weight: number): Promise<CompetitorVideo[]> {
      return [
        {
          videoId: "v1",
          channelId: channel.channelId,
          channelName,
          title: "short",
          publishedAt: "2026-09-01T00:00:00Z",
          durationSeconds: 30,
          weight,
        },
      ];
    },
  };
}

describe("runCompetitorScan", () => {
  it("skips channels that fail to resolve and still builds a plan", async () => {
    const events: EventsReader = { read: () => [] };
    const captured: { videos?: CompetitorVideo[] } = {};

    const result = await runCompetitorScan({
      youtube: fakeYouTube(),
      analyst: {
        async summarise(videos) {
          captured.videos = [...videos];
          return emptyInsights;
        },
      },
      planner: {
        async generate(): Promise<ContentPlan> {
          return {
            month: "2026-09",
            startDate: "2026-09-29",
            endDate: "2026-10-28",
            timezone: cadence.timezone,
            slots: [
              {
                date: "2026-09-30",
                time: "09:00",
                format: "Responde a Bix",
                source: "evergreen",
                topic: "t",
                brandFit: 8,
                hook: "h",
                why: "w",
                assets: [],
              },
            ],
          };
        },
      },
      events,
      channels: [
        { name: "Good", handle: "@good", weight: 1 },
        { name: "Broken", handle: "@broken", weight: 1 },
      ],
      maxVideosPerChannel: 10,
      maxShortSeconds: 180,
      planDays: 30,
      cadence,
      today: new Date("2026-09-29T00:00:00Z"),
    });

    expect(result.channels).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].channel.name).toBe("Broken");
    expect(result.videos).toHaveLength(1);
    expect(captured.videos).toHaveLength(1);
    expect(result.plan.slots).toHaveLength(1);
    expect(result.date).toBe("2026-09-29");
  });
});
