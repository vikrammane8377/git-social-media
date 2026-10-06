import { describe, it, expect } from "vitest";
import { chooseSlot, todayLocalISODate, type DailySource } from "./run-daily.js";
import type { PlanSlotRecord } from "@bix/youtube";

function slot(id: string, source: DailySource, time: string): PlanSlotRecord {
  return {
    id,
    month: "2026-10",
    date: "2026-10-01",
    time,
    format: "False-friend reveal",
    source,
    topic: `topic ${id}`,
    brandFit: 7,
    hook: "",
    why: "",
    assets: [],
  };
}

const none = (): boolean => false;

describe("chooseSlot", () => {
  const day = [
    slot("2026-10-001", "event", "09:00"),
    slot("2026-10-002", "competitor", "17:00"),
  ];

  it("runs the matching source's slot", () => {
    expect(chooseSlot(day, "event", none)).toEqual({ kind: "run", slot: day[0] });
    expect(chooseSlot(day, "competitor", none)).toEqual({ kind: "run", slot: day[1] });
  });

  it("skips when no slot of that source is scheduled", () => {
    const onlyEvents = [slot("2026-10-001", "event", "09:00")];
    expect(chooseSlot(onlyEvents, "competitor", none)).toEqual({
      kind: "skip",
      reason: "no competitor slot scheduled",
    });
  });

  it("skips when the only matching slot is already published", () => {
    const published = (id: string): boolean => id === "2026-10-001";
    expect(chooseSlot(day, "event", published)).toEqual({
      kind: "skip",
      reason: "event slot already published",
    });
  });

  it("picks the earliest still-unpublished slot when a source has several", () => {
    const two = [
      slot("2026-10-001", "event", "08:00"),
      slot("2026-10-003", "event", "12:00"),
    ];
    const firstDone = (id: string): boolean => id === "2026-10-001";
    expect(chooseSlot(two, "event", firstDone)).toEqual({ kind: "run", slot: two[1] });
  });
});

describe("todayLocalISODate", () => {
  it("formats a date as local YYYY-MM-DD with zero padding", () => {
    expect(todayLocalISODate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("uses local calendar fields (no UTC shift)", () => {
    // Late local evening must still report that local day, not roll to the next.
    expect(todayLocalISODate(new Date(2026, 9, 1, 23, 59))).toBe("2026-10-01");
  });
});
