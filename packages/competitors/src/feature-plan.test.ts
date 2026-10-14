import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import type { ChannelConfig } from "@bix/config";
import { ContentPlanStore } from "./store.js";
import type { ContentPlan } from "./types.js";
import {
  FEATURE_MONTH,
  topicFromFilename,
  featureSlotId,
  buildFeatureSlots,
  insertFeatureSlots,
} from "./feature-plan.js";

function channel(id: "spanish" | "global", time = "09:00"): ChannelConfig {
  return {
    id,
    posting: { time, timezone: "America/Mexico_City" },
    outroCta: "cta",
  } as unknown as ChannelConfig;
}

function scanPlan(slots: number): ContentPlan {
  return {
    month: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-30",
    timezone: "America/Mexico_City",
    slots: Array.from({ length: slots }, (_, i) => ({
      date: `2026-10-0${i + 1}`,
      time: "09:00",
      channel: "spanish" as const,
      format: "Responde a Bix",
      source: "evergreen" as const,
      topic: `topic ${i}`,
      brandFit: 8,
      hook: "hook",
      why: "why",
      assets: ["bg"],
    })),
  };
}

describe("topicFromFilename", () => {
  it("drops the index, a leading channel word, and title-cases the rest", () => {
    expect(topicFromFilename("assets/brand/screenshots/07-spanish-picture-matching.png")).toBe(
      "Picture matching",
    );
    expect(topicFromFilename("01-learning-path.png")).toBe("Learning path");
  });

  it("falls back to a generic topic when nothing meaningful remains", () => {
    expect(topicFromFilename("05.png")).toBe("App feature");
  });
});

describe("buildFeatureSlots", () => {
  it("emits one feature slot per screenshot per channel, with the screenshot in assets", () => {
    const screenshots = [
      "assets/brand/screenshots/01-learning-path.png",
      "assets/brand/screenshots/07-picture-matching.png",
    ];
    const slots = buildFeatureSlots(screenshots, [channel("spanish"), channel("global")]);

    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect(slot.source).toBe("feature");
      expect(slot.format).toBe("Feature demo");
      expect(slot.assets).toHaveLength(1);
      expect(screenshots).toContain(slot.assets[0]);
    }
    // Topic derives from the filename.
    const first = slots.find((s) => s.assets[0]?.includes("learning-path"));
    expect(first?.topic).toBe("Learning path");
  });
});

describe("insertFeatureSlots", () => {
  it("writes month-independent ids under the feature month without deleting scan slots", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ContentPlanStore(db);
    store.init();

    // A real monthly scan already lives in the table.
    store.save(scanPlan(3));
    expect(store.countSlots("2026-10")).toBe(3);

    const screenshots = [
      "assets/brand/screenshots/01-learning-path.png",
      "assets/brand/screenshots/07-picture-matching.png",
    ];
    const slots = buildFeatureSlots(screenshots, [channel("spanish"), channel("global")]);
    const ids = insertFeatureSlots(db, slots);

    // Ids are stable and month-independent.
    expect(ids).toContain(featureSlotId("spanish", "01"));
    expect(ids).toContain(featureSlotId("global", "07"));

    // Feature rows land under the feature month...
    expect(store.countSlots(FEATURE_MONTH)).toBe(4);
    // ...and the scan slots are untouched.
    expect(store.countSlots("2026-10")).toBe(3);

    db.close();
  });

  it("re-inserting the same screenshots replaces rather than duplicates feature rows", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ContentPlanStore(db);
    store.init();

    const screenshots = ["assets/brand/screenshots/01-learning-path.png"];
    const slots = buildFeatureSlots(screenshots, [channel("spanish")]);
    insertFeatureSlots(db, slots);
    insertFeatureSlots(db, slots);

    expect(store.countSlots(FEATURE_MONTH)).toBe(1);

    db.close();
  });
});
