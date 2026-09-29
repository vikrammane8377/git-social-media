import type { Database } from "@bix/storage";
import type { ContentPlan } from "./types.js";

/**
 * Persists content plans so later components (script writer, approval screen)
 * can read them. A plan is keyed by its month (YYYY-MM); re-running the scan for
 * the same month replaces that month's slots.
 */
export class ContentPlanStore {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_plans (
        month       TEXT PRIMARY KEY,
        start_date  TEXT NOT NULL,
        end_date    TEXT NOT NULL,
        timezone    TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plan_slots (
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
  }

  /** Save (replace) a plan and its slots for the plan's month. */
  save(plan: ContentPlan, now: string = new Date().toISOString()): void {
    this.db.run("DELETE FROM plan_slots WHERE month = ?", [plan.month]);
    this.db.run(
      `INSERT OR REPLACE INTO content_plans (month, start_date, end_date, timezone, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [plan.month, plan.startDate, plan.endDate, plan.timezone, now],
    );
    let i = 0;
    for (const slot of plan.slots) {
      i += 1;
      this.db.run(
        `INSERT OR REPLACE INTO plan_slots
          (id, month, slot_date, slot_time, format, source, topic, brand_fit, hook, why, assets, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${plan.month}-${String(i).padStart(3, "0")}`,
          plan.month,
          slot.date,
          slot.time,
          slot.format,
          slot.source,
          slot.topic,
          slot.brandFit,
          slot.hook,
          slot.why,
          JSON.stringify(slot.assets),
          now,
        ],
      );
    }
  }

  /** Count slots stored for a month (used by tests). */
  countSlots(month: string): number {
    const row = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM plan_slots WHERE month = ?", [month]);
    return row ? Number(row.n) : 0;
  }
}
