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
  db.run(
    `INSERT INTO plan_slots
      (id, month, slot_date, slot_time, format, source, topic, brand_fit, hook, why, assets, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "2026-10-001",
      "2026-10",
      "2026-10-01",
      "09:00",
      "Responde a Bix",
      "evergreen",
      "Ordering coffee",
      8,
      "hook",
      "why",
      JSON.stringify(["bix.png"]),
      "2026-10-01T00:00:00Z",
    ],
  );
  return db;
}

describe("PlanSlotReader (scripts)", () => {
  it("reads a slot by id and parses its assets", () => {
    const reader = new PlanSlotReader(seededDb());
    const slot = reader.getById("2026-10-001");
    expect(slot?.topic).toBe("Ordering coffee");
    expect(slot?.assets).toEqual(["bix.png"]);
  });

  it("returns undefined for an unknown id", () => {
    const reader = new PlanSlotReader(seededDb());
    expect(reader.getById("missing")).toBeUndefined();
  });

  it("returns undefined/[] when the plan_slots table does not exist", () => {
    const reader = new PlanSlotReader(new SqliteDatabase(":memory:"));
    expect(reader.getById("2026-10-001")).toBeUndefined();
    expect(reader.getByDate("2026-10-01")).toEqual([]);
  });
});
