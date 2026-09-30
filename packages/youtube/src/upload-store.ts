import type { Database } from "@bix/storage";

/** Lifecycle status of a YouTube upload. */
export type UploadStatus = "SUBMITTED" | "COMPLETED" | "FAILED";

export interface YouTubeUploadRecord {
  /** Primary key: the video's storage key (e.g. outputs/video/foo.mp4). */
  id: string;
  slotId: string;
  title: string;
  privacy: string;
  /** The YouTube video id, once the upload completes. */
  youtubeVideoId: string | null;
  status: UploadStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  slot_id: string;
  title: string;
  privacy: string;
  youtube_video_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: Row): YouTubeUploadRecord {
  return {
    id: row.id,
    slotId: row.slot_id,
    title: row.title,
    privacy: row.privacy,
    youtubeVideoId: row.youtube_video_id,
    status: row.status as UploadStatus,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Records YouTube uploads keyed by the video's storage key so a rerun does not
 * double-post the same file: if a COMPLETED row with a youtube_video_id already
 * exists for the key, the caller skips and reuses the existing URL.
 */
export class YouTubeUploadStore {
  constructor(private readonly db: Database) {}

  /** Create the table if it does not exist. Safe to call repeatedly. */
  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS youtube_uploads (
        id               TEXT PRIMARY KEY,
        slot_id          TEXT NOT NULL,
        title            TEXT NOT NULL,
        privacy          TEXT NOT NULL,
        youtube_video_id TEXT,
        status           TEXT NOT NULL,
        error            TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);
  }

  get(id: string): YouTubeUploadRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM youtube_uploads WHERE id = ?", [id]);
    return row ? toRecord(row) : undefined;
  }

  /** Insert or replace a record for a freshly-submitted upload. */
  create(
    record: Omit<YouTubeUploadRecord, "createdAt" | "updatedAt">,
    now: string = new Date().toISOString(),
  ): YouTubeUploadRecord {
    this.db.run(
      `INSERT OR REPLACE INTO youtube_uploads
        (id, slot_id, title, privacy, youtube_video_id, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.slotId,
        record.title,
        record.privacy,
        record.youtubeVideoId,
        record.status,
        record.error,
        now,
        now,
      ],
    );
    return { ...record, createdAt: now, updatedAt: now };
  }

  /** Patch mutable fields on an existing record and bump updated_at. */
  update(
    id: string,
    patch: Partial<Pick<YouTubeUploadRecord, "youtubeVideoId" | "status" | "error">>,
    now: string = new Date().toISOString(),
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if ("youtubeVideoId" in patch) {
      sets.push("youtube_video_id = ?");
      params.push(patch.youtubeVideoId ?? null);
    }
    if ("status" in patch) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if ("error" in patch) {
      sets.push("error = ?");
      params.push(patch.error ?? null);
    }
    sets.push("updated_at = ?");
    params.push(now);
    params.push(id);
    this.db.run(`UPDATE youtube_uploads SET ${sets.join(", ")} WHERE id = ?`, params);
  }
}
