import type { Database } from "@bix/storage";
import type { ScriptResult } from "./types.js";

/**
 * Persists generated scripts so later components (the orchestrator, the video
 * step) can read them. A script is keyed by its plan slot id; re-running the
 * writer for the same slot replaces that slot's row (INSERT OR REPLACE), so
 * reruns never duplicate. Mirrors `ContentPlanStore`'s style/`init()`.
 */
export class ScriptStore {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scripts (
        slot_id          TEXT PRIMARY KEY,
        title            TEXT,
        scene_prompt     TEXT NOT NULL,
        dialogue         TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        video_prompt     TEXT NOT NULL,
        decision         TEXT NOT NULL,
        review_json      TEXT NOT NULL,
        revisions        INTEGER NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        assets_used      TEXT NOT NULL DEFAULT '[]',
        needed_images    TEXT NOT NULL DEFAULT '[]'
      )
    `);
    // Idempotent migrations for DBs created before these columns existed.
    this.addColumnIfMissing("assets_used", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumnIfMissing("needed_images", "TEXT NOT NULL DEFAULT '[]'");
  }

  private addColumnIfMissing(name: string, decl: string): void {
    if (!this.hasColumn(name)) {
      this.db.exec(`ALTER TABLE scripts ADD COLUMN ${name} ${decl}`);
    }
  }

  private hasColumn(name: string): boolean {
    const rows = this.db.all<{ name: string }>("PRAGMA table_info(scripts)");
    return rows.some((r) => r.name === name);
  }

  /** Save (replace) the script for a slot, keyed by slot id. */
  save(result: ScriptResult, now: string = new Date().toISOString()): void {
    const existing = this.db.get<{ created_at: string }>(
      "SELECT created_at FROM scripts WHERE slot_id = ?",
      [result.slotId],
    );
    const createdAt = existing ? existing.created_at : now;
    this.db.run(
      `INSERT OR REPLACE INTO scripts
        (slot_id, title, scene_prompt, dialogue, duration_seconds, video_prompt,
         decision, review_json, revisions, created_at, updated_at, assets_used, needed_images)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.slotId,
        result.draft.title ?? null,
        result.draft.scenePrompt,
        result.draft.dialogue,
        result.draft.durationSeconds,
        result.videoPrompt,
        result.review.decision,
        JSON.stringify(result.review),
        result.revisions,
        createdAt,
        now,
        JSON.stringify(result.draft.usedAssets ?? []),
        JSON.stringify(result.draft.neededImages ?? []),
      ],
    );
  }

  /** Count stored scripts for a slot (0 or 1). Used by tests. */
  count(slotId: string): number {
    const row = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM scripts WHERE slot_id = ?", [slotId]);
    return row ? Number(row.n) : 0;
  }
}
