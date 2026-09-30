import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { PlanSlotReader } from "./plan-slot-reader.js";

/** Recreate Component 3's plan_slots schema and seed rows. */
function seededDb(): SqliteDatabase {
  const db = new SqliteDatabase(":memory:");
  db.exec(`
    CREATE TABLE plan_slots (
      id         TEXT PRIMARY KEY,
      month      TEXT NOT NULL,
      slot_date  TEXT NOT NULL,
      slot_time  TEXT NOT NULL,
      format     TEXT NOT NULL,
      source     TEXT NOT NULL,
      topic      TEXT NOT NULL,
      brand_fit  INTEGER NOT NULL,
      hook       TEXT,
      why        TEXT,
      assets     TEXT,
      created_at TEXT NOT NULL
    )
  `);
  const insert = (
    id: string,
    date: string,
    time: string,
    topic: string,
    assets: string,
  ): void => {
    db.run(
      `INSERT INTO plan_slots
        (id, month, slot_date, slot_time, format, source, topic, brand_fit, hook, why, assets, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, "2026-10", date, time, "short", "competitor", topic, 8, "hook", "why", assets, "2026-10-01T00:00:00Z"],
    );
  };
  insert("2026-10-001", "2026-10-01", "09:00", "Topic one", JSON.stringify(["bix.png"]));
  insert("2026-10-002", "2026-10-02", "09:00", "Topic two", JSON.stringify(["bix.png", "logo.png"]));
  insert("2026-10-003", "2026-10-02", "18:00", "Topic three", "not-json");
  return db;
}

describe("PlanSlotReader", () => {
  it("reads a slot by id and parses its assets JSON", () => {
    const reader = new PlanSlotReader(seededDb());
    const slot = reader.getById("2026-10-002");
    expect(slot?.topic).toBe("Topic two");
    expect(slot?.date).toBe("2026-10-02");
    expect(slot?.assets).toEqual(["bix.png", "logo.png"]);
  });

  it("returns undefined for an unknown id", () => {
    const reader = new PlanSlotReader(seededDb());
    expect(reader.getById("missing")).toBeUndefined();
  });

  it("returns all slots for a date so the CLI can require --slot", () => {
    const reader = new PlanSlotReader(seededDb());
    const slots = reader.getByDate("2026-10-02");
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.id)).toEqual(["2026-10-002", "2026-10-003"]);
  });

  it("returns one slot for a date with a single slot", () => {
    const reader = new PlanSlotReader(seededDb());
    expect(reader.getByDate("2026-10-01")).toHaveLength(1);
  });

  it("tolerates unparseable assets by returning an empty array", () => {
    const reader = new PlanSlotReader(seededDb());
    expect(reader.getById("2026-10-003")?.assets).toEqual([]);
  });

  it("returns undefined/[] when the plan_slots table does not exist", () => {
    const reader = new PlanSlotReader(new SqliteDatabase(":memory:"));
    expect(reader.getById("2026-10-001")).toBeUndefined();
    expect(reader.getByDate("2026-10-01")).toEqual([]);
  });
});
