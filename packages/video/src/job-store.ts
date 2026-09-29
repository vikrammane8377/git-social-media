import type { Database } from "@bix/storage";

/** Local lifecycle status of a video job (distinct from the provider's status). */
export type JobStatus = "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface VideoJobRecord {
  /** Deterministic key derived from the inputs; identifies a rerun of the same job. */
  id: string;
  provider: string;
  endpoint: string;
  /** The provider request id, saved immediately after submit so work can resume. */
  requestId: string | null;
  status: JobStatus;
  /** JSON of the input we sent (prompt + params + ref URLs). Never contains secrets. */
  inputJson: string;
  /** Storage key of the downloaded MP4, once complete. */
  outputPath: string | null;
  seed: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  provider: string;
  endpoint: string;
  request_id: string | null;
  status: string;
  input_json: string;
  output_path: string | null;
  seed: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: Row): VideoJobRecord {
  return {
    id: row.id,
    provider: row.provider,
    endpoint: row.endpoint,
    requestId: row.request_id,
    status: row.status as JobStatus,
    inputJson: row.input_json,
    outputPath: row.output_path,
    seed: row.seed,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Persists video jobs so an interrupted run can be resumed instead of resubmitted. */
export class VideoJobStore {
  constructor(private readonly db: Database) {}

  /** Create the table if it does not exist. Safe to call repeatedly. */
  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_jobs (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        endpoint    TEXT NOT NULL,
        request_id  TEXT,
        status      TEXT NOT NULL,
        input_json  TEXT NOT NULL,
        output_path TEXT,
        seed        INTEGER,
        error       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
  }

  get(id: string): VideoJobRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM video_jobs WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  /** Insert a freshly-submitted job, persisting its request id immediately. */
  create(
    record: Omit<VideoJobRecord, "createdAt" | "updatedAt">,
    now: string = new Date().toISOString(),
  ): VideoJobRecord {
    this.db.run(
      `INSERT INTO video_jobs
        (id, provider, endpoint, request_id, status, input_json, output_path, seed, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.provider,
        record.endpoint,
        record.requestId,
        record.status,
        record.inputJson,
        record.outputPath,
        record.seed,
        record.error,
        now,
        now,
      ],
    );
    return { ...record, createdAt: now, updatedAt: now };
  }

  /** Patch mutable fields on an existing job and bump updated_at. */
  update(
    id: string,
    patch: Partial<Pick<VideoJobRecord, "requestId" | "status" | "outputPath" | "seed" | "error">>,
    now: string = new Date().toISOString(),
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if ("requestId" in patch) {
      sets.push("request_id = ?");
      params.push(patch.requestId ?? null);
    }
    if ("status" in patch) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if ("outputPath" in patch) {
      sets.push("output_path = ?");
      params.push(patch.outputPath ?? null);
    }
    if ("seed" in patch) {
      sets.push("seed = ?");
      params.push(patch.seed ?? null);
    }
    if ("error" in patch) {
      sets.push("error = ?");
      params.push(patch.error ?? null);
    }
    sets.push("updated_at = ?");
    params.push(now);
    params.push(id);
    this.db.run(`UPDATE video_jobs SET ${sets.join(", ")} WHERE id = ?`, params);
  }
}
