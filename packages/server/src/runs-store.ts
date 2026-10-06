import type { Database } from "@bix/storage";

/**
 * The `runs` table is owned by the server (not the pipeline packages). It
 * records each CLI job the dashboard triggers so a run's live log and final
 * status survive a page refresh and can be listed on the Runs page.
 */

export type RunKind = "script" | "generate" | "publish" | "orchestrate";
export type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface RunRecord {
  id: string;
  kind: RunKind;
  slotId: string | null;
  argsJson: string;
  status: RunStatus;
  exitCode: number | null;
  /** Appended stdout+stderr text captured line-by-line. */
  log: string;
  startedAt: string;
  endedAt: string | null;
}

interface Row {
  id: string;
  kind: string;
  slot_id: string | null;
  args_json: string;
  status: string;
  exit_code: number | null;
  log: string;
  started_at: string;
  ended_at: string | null;
}

function toRecord(row: Row): RunRecord {
  return {
    id: row.id,
    kind: row.kind as RunKind,
    slotId: row.slot_id,
    argsJson: row.args_json,
    status: row.status as RunStatus,
    exitCode: row.exit_code == null ? null : Number(row.exit_code),
    log: row.log,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export interface CreateRunInput {
  id: string;
  kind: RunKind;
  slotId: string | null;
  args: readonly string[];
}

export class RunsStore {
  constructor(private readonly db: Database) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        slot_id    TEXT,
        args_json  TEXT NOT NULL,
        status     TEXT NOT NULL,
        exit_code  INTEGER,
        log        TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at   TEXT
      )
    `);
  }

  create(input: CreateRunInput, now: string = new Date().toISOString()): RunRecord {
    this.db.run(
      `INSERT INTO runs (id, kind, slot_id, args_json, status, exit_code, log, started_at, ended_at)
       VALUES (?, ?, ?, ?, 'RUNNING', NULL, '', ?, NULL)`,
      [input.id, input.kind, input.slotId, JSON.stringify(input.args), now],
    );
    return {
      id: input.id,
      kind: input.kind,
      slotId: input.slotId,
      argsJson: JSON.stringify(input.args),
      status: "RUNNING",
      exitCode: null,
      log: "",
      startedAt: now,
      endedAt: null,
    };
  }

  /** Append a chunk of log text to a run. */
  appendLog(id: string, chunk: string): void {
    this.db.run("UPDATE runs SET log = log || ? WHERE id = ?", [chunk, id]);
  }

  /** Mark a run finished with its exit code. */
  finish(
    id: string,
    status: RunStatus,
    exitCode: number | null,
    now: string = new Date().toISOString(),
  ): void {
    this.db.run(
      "UPDATE runs SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?",
      [status, exitCode, now, id],
    );
  }

  get(id: string): RunRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM runs WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  list(limit = 50): RunRecord[] {
    return this.db
      .all<Row>("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", [limit])
      .map(toRecord);
  }
}
