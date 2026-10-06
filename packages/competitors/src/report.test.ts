import { describe, it, expect } from "vitest";
import { renderPlanReport, renderPlanJson } from "./report.js";
import type { CompetitorScanResult } from "./types.js";

function result(): CompetitorScanResult {
  return {
    date: "2026-09-29",
    channels: [{ channelId: "UC1", title: "Duolingo Spanish", uploadsPlaylistId: "UU1", subscriberCount: 1000 }],
    videos: [
      {
        videoId: "v1",
        channelId: "UC1",
        channelName: "Duolingo Spanish",
        title: "short",
        publishedAt: "2026-09-01T00:00:00Z",
        durationSeconds: 30,
        weight: 1,
      },
    ],
    insights: {
      formats: ["skit"],
      hooks: ["question"],
      lengths: "15-30s",
      postingRhythm: "daily",
      themes: ["false friends"],
      ctas: ["download"],
      notes: ["Public counts cannot distinguish organic vs paid reach."],
    },
    plan: {
      month: "2026-10",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      timezone: "America/Mexico_City",
      slots: [
        {
          date: "2026-10-01",
          time: "09:00",
          format: "Responde a Bix",
          source: "event",
          topic: "Halloween",
          brandFit: 9,
          hook: "Boo! Say it in English.",
          why: "Seasonal event",
          assets: ["bg"],
        },
      ],
    },
    unresolved: [{ channel: { name: "Falou", handle: "@falou_app", weight: 0.5 }, reason: "not found" }],
  };
}

describe("renderPlanReport", () => {
  it("renders channels, the reach caveat, insights and slots", () => {
    const md = renderPlanReport(result());
    expect(md).toContain("# Content plan — 2026-10");
    // Dynamic plan header reflects per-source counts (1 event, 0 competitor).
    expect(md).toContain("## Plan (1 slot(s): 1 event, 0 competitor)");
    expect(md).toContain("Duolingo Spanish");
    expect(md).toContain("organic vs paid");
    expect(md).toContain("Responde a Bix");
    expect(md).toContain("Boo! Say it in English.");
    expect(md).toContain("Unresolved channels");
    expect(md).toContain("Falou");
  });
});

describe("renderPlanJson", () => {
  it("produces valid JSON with the plan and insights", () => {
    const json = JSON.parse(renderPlanJson(result()));
    expect(json.plan.month).toBe("2026-10");
    expect(json.plan.slots).toHaveLength(1);
    expect(json.videoCount).toBe(1);
  });
});
