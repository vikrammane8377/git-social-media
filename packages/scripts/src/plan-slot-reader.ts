import type { Database } from "@bix/storage";

/**
 * One stored plan slot from Component 3's `plan_slots` table, including its
 * primary-key id (the CLI needs the id to pick a slot and to key the script
 * record). `assets` is stored as a JSON array string and parsed back here.
 */
export interface PlanSlotRecord {
  id: string;
  month: string;
  date: string;
  time: string;
  format: string;
  source: string;
  topic: string;
  brandFit: number;
  hook: string;
  why: string;
  assets: string[];
}

interface PlanSlotRow {
  id: string;
  month: string;
  slot_date: string;
  slot_time: string;
  format: string;
  source: string;
  topic: string;
  brand_fit: number;
  hook: string | null;
  why: string | null;
  assets: string | null;
  created_at: string;
}

function parseAssets(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function toRecord(row: PlanSlotRow): PlanSlotRecord {
  return {
    id: row.id,
    month: row.month,
    date: row.slot_date,
    time: row.slot_time,
    format: row.format,
    source: row.source,
    topic: row.topic,
    brandFit: Number(row.brand_fit),
    hook: row.hook ?? "",
    why: row.why ?? "",
    assets: parseAssets(row.assets),
  };
}

/**
 * Reads content-plan slots saved by Component 3 (`plan_slots` table). If the
 * table does not exist yet (no plan has ever been generated), the accessors
 * return undefined/[] rather than throwing, mirroring `LatestEventsReader`.
 */
export class PlanSlotReader {
  constructor(private readonly db: Database) {}

  /** Fetch one slot by its primary-key id, or undefined if missing. */
  getById(id: string): PlanSlotRecord | undefined {
    if (!this.tableExists()) return undefined;
    const row = this.db.get<PlanSlotRow>("SELECT * FROM plan_slots WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  /**
   * Fetch every slot scheduled on a date. Returns all matches so the CLI can
   * require `--slot` to disambiguate when a date has more than one slot.
   */
  getByDate(date: string): PlanSlotRecord[] {
    if (!this.tableExists()) return [];
    const rows = this.db.all<PlanSlotRow>(
      "SELECT * FROM plan_slots WHERE slot_date = ? ORDER BY slot_time ASC, id ASC",
      [date],
    );
    return rows.map(toRecord);
  }

  private tableExists(): boolean {
    const row = this.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_slots'",
    );
    return Boolean(row);
  }
}
