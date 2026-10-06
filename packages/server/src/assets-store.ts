import type { Database } from "@bix/storage";

/**
 * The `assets` table is owned by the server. It records tagged image assets the
 * owner uploads through the dashboard so the script writer can auto-select
 * matching references (by tag/description) at generation time. Mirrors the
 * style of {@link RunsStore}: a plain `init()` + CRUD over a single table.
 */

/** Lifecycle of the background vision analysis for an asset. */
export type AnalysisStatus = "" | "pending" | "done" | "error";

export interface AssetRecord {
  id: string;
  /** Storage key under assets/uploads/, e.g. "assets/uploads/<id>-name.png". */
  storagePath: string;
  filename: string;
  mime: string;
  tags: string[];
  description: string;
  /** Vision analysis of the image wrt the project (filled in the background). */
  analysis: string;
  /** "" when no analysis was attempted; otherwise pending|done|error. */
  analysisStatus: AnalysisStatus;
  /** When false the asset is kept but never offered to the writer or generation. */
  enabled: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  storage_path: string;
  filename: string;
  mime: string;
  tags_json: string;
  description: string;
  analysis: string | null;
  analysis_status: string | null;
  enabled: number | null;
  created_at: string;
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

function toStatus(raw: string | null): AnalysisStatus {
  return raw === "pending" || raw === "done" || raw === "error" ? raw : "";
}

function toRecord(row: Row): AssetRecord {
  return {
    id: row.id,
    storagePath: row.storage_path,
    filename: row.filename,
    mime: row.mime,
    tags: parseTags(row.tags_json),
    description: row.description ?? "",
    analysis: row.analysis ?? "",
    analysisStatus: toStatus(row.analysis_status),
    // Default to enabled when the column is absent (older rows) or null.
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
  };
}

export interface CreateAssetInput {
  id: string;
  storagePath: string;
  filename: string;
  mime: string;
  tags: string[];
  description: string;
  /** Initial analysis status; "pending" when a background analyzer will run. */
  analysisStatus?: AnalysisStatus;
}

export class AssetsStore {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id              TEXT PRIMARY KEY,
        storage_path    TEXT NOT NULL,
        filename        TEXT NOT NULL,
        mime            TEXT NOT NULL,
        tags_json       TEXT NOT NULL,
        description     TEXT NOT NULL,
        analysis        TEXT NOT NULL DEFAULT '',
        analysis_status TEXT NOT NULL DEFAULT '',
        enabled         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL
      )
    `);
    // Idempotently add columns to databases created before they existed
    // (mirrors ScriptStore's assets_used migration).
    this.addColumnIfMissing("analysis", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("analysis_status", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing("enabled", "INTEGER NOT NULL DEFAULT 1");
  }

  private addColumnIfMissing(column: string, decl: string): void {
    const cols = this.db.all<{ name: string }>("PRAGMA table_info(assets)");
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE assets ADD COLUMN ${column} ${decl}`);
    }
  }

  create(input: CreateAssetInput, now: string = new Date().toISOString()): AssetRecord {
    const analysisStatus = input.analysisStatus ?? "";
    this.db.run(
      `INSERT INTO assets (id, storage_path, filename, mime, tags_json, description, analysis, analysis_status, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.storagePath,
        input.filename,
        input.mime,
        JSON.stringify(input.tags),
        input.description,
        "",
        analysisStatus,
        1,
        now,
      ],
    );
    return {
      id: input.id,
      storagePath: input.storagePath,
      filename: input.filename,
      mime: input.mime,
      tags: input.tags,
      description: input.description,
      analysis: "",
      analysisStatus,
      enabled: true,
      createdAt: now,
    };
  }

  /**
   * Record the outcome of the background vision analysis. Any field left
   * undefined is kept as-is; `tags` replaces the stored tag list when supplied
   * (the route merges uploader tags with suggested tags before calling this).
   */
  updateAnalysis(
    id: string,
    fields: { analysis?: string; tags?: string[]; status?: AnalysisStatus },
  ): AssetRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const analysis = fields.analysis ?? existing.analysis;
    const tags = fields.tags ?? existing.tags;
    const status = fields.status ?? existing.analysisStatus;
    this.db.run(
      "UPDATE assets SET analysis = ?, tags_json = ?, analysis_status = ? WHERE id = ?",
      [analysis, JSON.stringify(tags), status, id],
    );
    return { ...existing, analysis, tags, analysisStatus: status };
  }

  list(): AssetRecord[] {
    return this.db
      .all<Row>("SELECT * FROM assets ORDER BY created_at DESC")
      .map(toRecord);
  }

  get(id: string): AssetRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM assets WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  /** Update tags and/or description; unspecified fields are left untouched. */
  updateTags(
    id: string,
    fields: { tags?: string[]; description?: string },
  ): AssetRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const tags = fields.tags ?? existing.tags;
    const description = fields.description ?? existing.description;
    this.db.run("UPDATE assets SET tags_json = ?, description = ? WHERE id = ?", [
      JSON.stringify(tags),
      description,
      id,
    ]);
    return { ...existing, tags, description };
  }

  /** Toggle whether the asset is offered to the writer/generation. */
  setEnabled(id: string, enabled: boolean): AssetRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run("UPDATE assets SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
    return { ...existing, enabled };
  }

  /** Remove a row. Returns true when a row was deleted. */
  remove(id: string): boolean {
    return this.db.run("DELETE FROM assets WHERE id = ?", [id]).changes > 0;
  }
}
