import { describe, it, expect } from "vitest";
import { chooseSlot, todayLocalISODate } from "./run-daily.js";
import type { ChannelId } from "@bix/config";
import type { PlanSlotRecord } from "@bix/youtube";

function slot(
  id: string,
  channel: ChannelId,
  time: string,
  source = "event",
): PlanSlotRecord {
  return {
    id,
    month: "2026-10",
    date: "2026-10-01",
    time,
    channel,
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
  // A day emits one slot per channel, each a free event/competitor mix.
  const day = [
    slot("2026-10-001", "spanish", "09:00", "event"),
    slot("2026-10-002", "global", "17:00", "competitor"),
  ];

  it("runs the matching channel's slot", () => {
    expect(chooseSlot(day, "spanish", none)).toEqual({ kind: "run", slot: day[0] });
    expect(chooseSlot(day, "global", none)).toEqual({ kind: "run", slot: day[1] });
  });

  it("skips when no slot of that channel is scheduled", () => {
    const onlySpanish = [slot("2026-10-001", "spanish", "09:00")];
    expect(chooseSlot(onlySpanish, "global", none)).toEqual({
      kind: "skip",
      reason: "no global slot scheduled",
    });
  });

  it("skips when the only matching slot is already published", () => {
    const published = (id: string): boolean => id === "2026-10-001";
    expect(chooseSlot(day, "spanish", published)).toEqual({
      kind: "skip",
      reason: "spanish slot already published",
    });
  });

  it("picks the earliest still-unpublished slot when a channel has several", () => {
    const two = [
      slot("2026-10-001", "spanish", "08:00"),
      slot("2026-10-003", "spanish", "12:00"),
    ];
    const firstDone = (id: string): boolean => id === "2026-10-001";
    expect(chooseSlot(two, "spanish", firstDone)).toEqual({ kind: "run", slot: two[1] });
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
