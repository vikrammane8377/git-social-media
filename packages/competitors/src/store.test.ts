import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { ContentPlanStore } from "./store.js";
import type { ContentPlan } from "./types.js";

function plan(slots: number): ContentPlan {
  return {
    month: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-30",
    timezone: "America/Mexico_City",
    slots: Array.from({ length: slots }, (_, i) => ({
      date: `2026-10-0${i + 1}`,
      time: "09:00",
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

describe("ContentPlanStore", () => {
  it("saves a plan and replaces slots on re-save for the same month", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ContentPlanStore(db);
    store.init();

    store.save(plan(3));
    expect(store.countSlots("2026-10")).toBe(3);

    // Re-saving the same month replaces (does not duplicate) slots.
    store.save(plan(2));
    expect(store.countSlots("2026-10")).toBe(2);

    db.close();
  });
});
