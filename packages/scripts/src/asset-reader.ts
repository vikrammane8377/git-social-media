import type { Database } from "@bix/storage";

/**
 * Read-only view over the `assets` table the server owns (see
 * `packages/server/src/assets-store.ts`). The script writer uses this to see the
 * tagged image library so it can auto-select matching references. If the table
 * does not exist yet (server never ran), the accessors return [] rather than
 * throwing — mirroring {@link PlanSlotReader}.
 */
export interface AssetRecord {
  /** Storage key under assets/uploads/ — the value passed to `--ref`. */
  key: string;
  filename: string;
  tags: string[];
  description: string;
  /** Background vision analysis of the image wrt the project ("" when none). */
  analysis: string;
}

interface Row {
  storage_path: string;
  filename: string;
  tags_json: string;
  description: string | null;
  analysis: string | null;
  enabled: number | null;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

function toRecord(row: Row): AssetRecord {
  return {
    key: row.storage_path,
    filename: row.filename,
    tags: parseTags(row.tags_json),
    description: row.description ?? "",
    analysis: row.analysis ?? "",
  };
}

export class AssetReader {
  constructor(private readonly db: Database) {}

  /**
   * Every ENABLED asset, newest first. [] when the table is absent. Disabled
   * assets are excluded so the writer never references an asset the owner turned
   * off (the `enabled` column may be absent on old DBs → treated as enabled).
   */
  list(): AssetRecord[] {
    if (!this.tableExists()) return [];
    return this.db
      .all<Row>("SELECT * FROM assets ORDER BY created_at DESC")
      .filter((row) => row.enabled !== 0)
      .map(toRecord);
  }

  /** Resolve a set of storage keys to their records, preserving input order. */
  byKeys(keys: readonly string[]): AssetRecord[] {
    if (keys.length === 0 || !this.tableExists()) return [];
    const all = new Map(this.list().map((a) => [a.key, a]));
    const out: AssetRecord[] = [];
    for (const k of keys) {
      const found = all.get(k);
      if (found) out.push(found);
    }
    return out;
  }

  private tableExists(): boolean {
    const row = this.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'",
    );
    return Boolean(row);
  }
}
