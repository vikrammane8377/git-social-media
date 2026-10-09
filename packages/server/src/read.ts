import type { Database } from "@bix/storage";

/**
 * Read-only view over the six pipeline tables the CLI writes:
 * `event_ideas`, `content_plans`, `plan_slots`, `scripts`, `video_jobs`,
 * `youtube_uploads`. Every method issues plain SELECTs — the dashboard never
 * mutates pipeline state; triggering happens by spawning the CLI (see jobs.ts).
 *
 * Joins are keyed by the slot id:
 *   plan_slots.id = scripts.slot_id = youtube_uploads.slot_id
 * and the finished video is linked through the upload's storage-key id:
 *   youtube_uploads.id = video_jobs.output_path
 *
 * Tables may not exist yet (a fresh DB before any CLI run). Reads guard against
 * that and return empty results instead of throwing.
 */

// ---- Row shapes (snake_case as stored) -----------------------------------

export interface EventIdea {
  id: string;
  scanDate: string;
  title: string;
  summary: string | null;
  eventDate: string;
  endDate: string | null;
  source: string;
  sourceUrl: string | null;
  country: string | null;
  brandFit: number;
  reason: string | null;
  suggestedFormat: string | null;
  windowEarliest: string | null;
  windowLatest: string | null;
  createdAt: string;
}

export interface EventScan {
  scanDate: string;
  count: number;
}

export interface ContentPlan {
  month: string;
  startDate: string;
  endDate: string;
  timezone: string;
  createdAt: string;
}

export interface PlanSlot {
  id: string;
  month: string;
  slotDate: string;
  slotTime: string;
  format: string;
  source: string;
  channel: string;
  topic: string;
  brandFit: number;
  hook: string | null;
  why: string | null;
  assets: string | null;
  createdAt: string;
}

export interface Script {
  slotId: string;
  title: string | null;
  scenePrompt: string;
  dialogue: string;
  durationSeconds: number;
  videoPrompt: string;
  decision: string;
  /** Parsed review verdict (englishMeaning, brandVoice, issues, ...). */
  review: unknown;
  revisions: number;
  /** Storage keys of the reference assets the writer chose (may be empty). */
  assetsUsed: string[];
  /** Images the writer asked to have generated (may be empty). Visibility only. */
  neededImages: NeededImage[];
  createdAt: string;
  updatedAt: string;
}

/** One image the writer requested, parsed from the stored `needed_images`. */
export interface NeededImage {
  prompt: string;
  purpose: string;
}

export interface VideoJob {
  id: string;
  provider: string;
  endpoint: string;
  requestId: string | null;
  status: string;
  inputJson: string;
  outputPath: string | null;
  seed: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Upload {
  id: string;
  slotId: string;
  title: string;
  privacy: string;
  youtubeVideoId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** Convenience: watch URL when a video id is present. */
  url: string | null;
}

/** One row per slot in the latest plan, with the whole pipeline flattened. */
export interface OverviewRow {
  slotId: string;
  month: string;
  slotDate: string;
  slotTime: string;
  format: string;
  source: string;
  channel: string;
  topic: string;
  brandFit: number;
  scriptDecision: string | null;
  scriptRevisions: number | null;
  videoStatus: string | null;
  videoOutputPath: string | null;
  uploadStatus: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
}

export interface SlotDetail {
  slot: PlanSlot;
  script: Script | null;
  video: VideoJob | null;
  upload: Upload | null;
}

const KNOWN_TABLES = [
  "event_ideas",
  "content_plans",
  "plan_slots",
  "scripts",
  "video_jobs",
  "youtube_uploads",
] as const;

function ytUrl(videoId: string | null | undefined): string | null {
  return videoId ? `https://youtu.be/${videoId}` : null;
}

export class DashboardReader {
  private readonly present = new Set<string>();

  constructor(private readonly db: Database) {
    const rows = this.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    for (const r of rows) this.present.add(r.name);
  }

  private has(table: (typeof KNOWN_TABLES)[number]): boolean {
    return this.present.has(table);
  }

  // ---- Events ------------------------------------------------------------

  listEvents(scanDate?: string): EventIdea[] {
    if (!this.has("event_ideas")) return [];
    const sql = scanDate
      ? "SELECT * FROM event_ideas WHERE scan_date = ? ORDER BY brand_fit DESC, event_date ASC"
      : "SELECT * FROM event_ideas ORDER BY scan_date DESC, brand_fit DESC";
    const rows = this.db.all<Record<string, unknown>>(sql, scanDate ? [scanDate] : []);
    return rows.map(mapEvent);
  }

  listEventScans(): EventScan[] {
    if (!this.has("event_ideas")) return [];
    return this.db
      .all<{ scan_date: string; n: number }>(
        "SELECT scan_date, COUNT(*) AS n FROM event_ideas GROUP BY scan_date ORDER BY scan_date DESC",
      )
      .map((r) => ({ scanDate: r.scan_date, count: Number(r.n) }));
  }

  // ---- Plans + slots -----------------------------------------------------

  listPlans(): ContentPlan[] {
    if (!this.has("content_plans")) return [];
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM content_plans ORDER BY month DESC")
      .map(mapPlan);
  }

  getPlan(month: string): ContentPlan | null {
    if (!this.has("content_plans")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM content_plans WHERE month = ?",
      [month],
    );
    return row ? mapPlan(row) : null;
  }

  latestPlan(): ContentPlan | null {
    if (!this.has("content_plans")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM content_plans ORDER BY month DESC LIMIT 1",
    );
    return row ? mapPlan(row) : null;
  }

  listSlots(month?: string): PlanSlot[] {
    if (!this.has("plan_slots")) return [];
    const sql = month
      ? "SELECT * FROM plan_slots WHERE month = ? ORDER BY slot_date ASC, slot_time ASC"
      : "SELECT * FROM plan_slots ORDER BY slot_date ASC, slot_time ASC";
    return this.db
      .all<Record<string, unknown>>(sql, month ? [month] : [])
      .map(mapSlot);
  }

  getSlot(id: string): PlanSlot | null {
    if (!this.has("plan_slots")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM plan_slots WHERE id = ?",
      [id],
    );
    return row ? mapSlot(row) : null;
  }

  // ---- Scripts -----------------------------------------------------------

  getScript(slotId: string): Script | null {
    if (!this.has("scripts")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM scripts WHERE slot_id = ?",
      [slotId],
    );
    return row ? mapScript(row) : null;
  }

  listScripts(): Script[] {
    if (!this.has("scripts")) return [];
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM scripts ORDER BY updated_at DESC")
      .map(mapScript);
  }

  // ---- Video jobs + uploads ---------------------------------------------

  listVideoJobs(): VideoJob[] {
    if (!this.has("video_jobs")) return [];
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM video_jobs ORDER BY updated_at DESC")
      .map(mapVideo);
  }

  /** Latest video job whose output was published under a given upload id (= storage key). */
  private videoForOutput(outputPath: string | null): VideoJob | null {
    if (!outputPath || !this.has("video_jobs")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM video_jobs WHERE output_path = ? ORDER BY updated_at DESC LIMIT 1",
      [outputPath],
    );
    return row ? mapVideo(row) : null;
  }

  listUploads(): Upload[] {
    if (!this.has("youtube_uploads")) return [];
    return this.db
      .all<Record<string, unknown>>("SELECT * FROM youtube_uploads ORDER BY updated_at DESC")
      .map(mapUpload);
  }

  getUpload(slotId: string): Upload | null {
    if (!this.has("youtube_uploads")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM youtube_uploads WHERE slot_id = ? ORDER BY updated_at DESC LIMIT 1",
      [slotId],
    );
    return row ? mapUpload(row) : null;
  }

  /** Slot + its script + finished video + upload, for the detail page. */
  getSlotDetail(id: string): SlotDetail | null {
    const slot = this.getSlot(id);
    if (!slot) return null;
    const upload = this.getUpload(id);
    const video = upload
      ? this.videoForOutput(upload.id)
      : this.latestVideoBySlotLabel(id);
    return {
      slot,
      script: this.getScript(id),
      video,
      upload,
    };
  }

  /**
   * When a slot has no upload yet, we can still surface a generated video by
   * matching the orchestrator's label convention `orchestrate-<slotId>` that
   * ends up in the output filename. Falls back to null when nothing matches.
   */
  private latestVideoBySlotLabel(slotId: string): VideoJob | null {
    if (!this.has("video_jobs")) return null;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM video_jobs WHERE output_path LIKE ? ORDER BY updated_at DESC LIMIT 1",
      [`%${slotId}%`],
    );
    return row ? mapVideo(row) : null;
  }

  // ---- The overview: one row per slot in the latest plan -----------------

  overview(): OverviewRow[] {
    const plan = this.latestPlan();
    if (!plan) return [];
    if (!this.has("plan_slots")) return [];

    const hasScripts = this.has("scripts");
    const hasUploads = this.has("youtube_uploads");
    const hasVideos = this.has("video_jobs");

    const scriptJoin = hasScripts
      ? "LEFT JOIN scripts s ON s.slot_id = ps.id"
      : "";
    // A slot can have several uploads (one per re-run); join only the newest so
    // the overview's "watch" link follows the latest video, not an arbitrary row.
    const uploadJoin = hasUploads
      ? `LEFT JOIN youtube_uploads u ON u.id = (
           SELECT id FROM youtube_uploads
           WHERE slot_id = ps.id
           ORDER BY updated_at DESC
           LIMIT 1
         )`
      : "";
    // A video is linked through the upload's storage-key id; only join when both
    // tables exist so the SQL stays valid on a partially-populated DB.
    const videoJoin =
      hasUploads && hasVideos
        ? "LEFT JOIN video_jobs v ON v.output_path = u.id"
        : "";

    const cols = [
      "ps.id AS slot_id",
      "ps.month AS month",
      "ps.slot_date AS slot_date",
      "ps.slot_time AS slot_time",
      "ps.format AS format",
      "ps.source AS source",
      "COALESCE(ps.channel, 'spanish') AS channel",
      "ps.topic AS topic",
      "ps.brand_fit AS brand_fit",
      hasScripts ? "s.decision AS script_decision" : "NULL AS script_decision",
      hasScripts ? "s.revisions AS script_revisions" : "NULL AS script_revisions",
      hasUploads && hasVideos ? "v.status AS video_status" : "NULL AS video_status",
      hasUploads && hasVideos ? "v.output_path AS video_output_path" : "NULL AS video_output_path",
      hasUploads ? "u.status AS upload_status" : "NULL AS upload_status",
      hasUploads ? "u.youtube_video_id AS youtube_video_id" : "NULL AS youtube_video_id",
    ].join(", ");

    const sql = `
      SELECT ${cols}
      FROM plan_slots ps
      ${scriptJoin}
      ${uploadJoin}
      ${videoJoin}
      WHERE ps.month = ?
      ORDER BY ps.slot_date ASC, ps.slot_time ASC
    `;

    const rows = this.db.all<Record<string, unknown>>(sql, [plan.month]);
    return rows.map((r) => ({
      slotId: String(r.slot_id),
      month: String(r.month),
      slotDate: String(r.slot_date),
      slotTime: String(r.slot_time),
      format: String(r.format),
      source: String(r.source),
      channel: String(r.channel ?? "spanish"),
      topic: String(r.topic),
      brandFit: Number(r.brand_fit),
      scriptDecision: (r.script_decision as string | null) ?? null,
      scriptRevisions:
        r.script_revisions == null ? null : Number(r.script_revisions),
      videoStatus: (r.video_status as string | null) ?? null,
      videoOutputPath: (r.video_output_path as string | null) ?? null,
      uploadStatus: (r.upload_status as string | null) ?? null,
      youtubeVideoId: (r.youtube_video_id as string | null) ?? null,
      youtubeUrl: ytUrl(r.youtube_video_id as string | null),
    }));
  }
}

// ---- Row mappers ---------------------------------------------------------

function mapEvent(r: Record<string, unknown>): EventIdea {
  return {
    id: String(r.id),
    scanDate: String(r.scan_date),
    title: String(r.title),
    summary: (r.summary as string | null) ?? null,
    eventDate: String(r.event_date),
    endDate: (r.end_date as string | null) ?? null,
    source: String(r.source),
    sourceUrl: (r.source_url as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    brandFit: Number(r.brand_fit),
    reason: (r.reason as string | null) ?? null,
    suggestedFormat: (r.suggested_format as string | null) ?? null,
    windowEarliest: (r.window_earliest as string | null) ?? null,
    windowLatest: (r.window_latest as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function mapPlan(r: Record<string, unknown>): ContentPlan {
  return {
    month: String(r.month),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    timezone: String(r.timezone),
    createdAt: String(r.created_at),
  };
}

function mapSlot(r: Record<string, unknown>): PlanSlot {
  return {
    id: String(r.id),
    month: String(r.month),
    slotDate: String(r.slot_date),
    slotTime: String(r.slot_time),
    format: String(r.format),
    source: String(r.source),
    channel: String(r.channel ?? "spanish"),
    topic: String(r.topic),
    brandFit: Number(r.brand_fit),
    hook: (r.hook as string | null) ?? null,
    why: (r.why as string | null) ?? null,
    assets: (r.assets as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function mapScript(r: Record<string, unknown>): Script {
  let review: unknown = null;
  const raw = r.review_json;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      review = JSON.parse(raw);
    } catch {
      review = null;
    }
  }
  let assetsUsed: string[] = [];
  const rawAssets = r.assets_used;
  if (typeof rawAssets === "string" && rawAssets.length > 0) {
    try {
      const parsed = JSON.parse(rawAssets) as unknown;
      if (Array.isArray(parsed)) {
        assetsUsed = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      assetsUsed = [];
    }
  }
  let neededImages: NeededImage[] = [];
  const rawNeeded = r.needed_images;
  if (typeof rawNeeded === "string" && rawNeeded.length > 0) {
    try {
      const parsed = JSON.parse(rawNeeded) as unknown;
      if (Array.isArray(parsed)) {
        neededImages = parsed.flatMap((v): NeededImage[] => {
          if (typeof v !== "object" || v === null) return [];
          const o = v as Record<string, unknown>;
          const prompt = typeof o.prompt === "string" ? o.prompt : "";
          const purpose = typeof o.purpose === "string" ? o.purpose : "";
          return prompt && purpose ? [{ prompt, purpose }] : [];
        });
      }
    } catch {
      neededImages = [];
    }
  }
  return {
    slotId: String(r.slot_id),
    title: (r.title as string | null) ?? null,
    scenePrompt: String(r.scene_prompt),
    dialogue: String(r.dialogue),
    durationSeconds: Number(r.duration_seconds),
    videoPrompt: String(r.video_prompt),
    decision: String(r.decision),
    review,
    revisions: Number(r.revisions),
    assetsUsed,
    neededImages,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapVideo(r: Record<string, unknown>): VideoJob {
  return {
    id: String(r.id),
    provider: String(r.provider),
    endpoint: String(r.endpoint),
    requestId: (r.request_id as string | null) ?? null,
    status: String(r.status),
    inputJson: String(r.input_json),
    outputPath: (r.output_path as string | null) ?? null,
    seed: r.seed == null ? null : Number(r.seed),
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapUpload(r: Record<string, unknown>): Upload {
  const youtubeVideoId = (r.youtube_video_id as string | null) ?? null;
  return {
    id: String(r.id),
    slotId: String(r.slot_id),
    title: String(r.title),
    privacy: String(r.privacy),
    youtubeVideoId,
    status: String(r.status),
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    url: ytUrl(youtubeVideoId),
  };
}
