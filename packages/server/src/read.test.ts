import { describe, it, expect } from "vitest";
import { SqliteDatabase, type Database } from "@bix/storage";
import { DashboardReader } from "./read.js";

/** Create all six pipeline tables, matching the stores' schemas. */
function createSchema(db: Database): void {
  db.exec(`CREATE TABLE event_ideas (
    id TEXT PRIMARY KEY, scan_date TEXT NOT NULL, title TEXT NOT NULL, summary TEXT,
    event_date TEXT NOT NULL, end_date TEXT, source TEXT NOT NULL, source_url TEXT,
    country TEXT, brand_fit INTEGER NOT NULL, reason TEXT, suggested_format TEXT,
    window_earliest TEXT, window_latest TEXT, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE content_plans (
    month TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    timezone TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE plan_slots (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, slot_date TEXT NOT NULL, slot_time TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'spanish', format TEXT NOT NULL, source TEXT NOT NULL,
    topic TEXT NOT NULL, brand_fit INTEGER NOT NULL,
    hook TEXT, why TEXT, assets TEXT, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE scripts (
    slot_id TEXT PRIMARY KEY, title TEXT, scene_prompt TEXT NOT NULL, dialogue TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL, video_prompt TEXT NOT NULL, decision TEXT NOT NULL,
    review_json TEXT NOT NULL, revisions INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE video_jobs (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, endpoint TEXT NOT NULL, request_id TEXT,
    status TEXT NOT NULL, input_json TEXT NOT NULL, output_path TEXT, seed INTEGER, error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE youtube_uploads (
    id TEXT PRIMARY KEY, slot_id TEXT NOT NULL, title TEXT NOT NULL, privacy TEXT NOT NULL,
    youtube_video_id TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
}

const VIDEO_KEY = "outputs/video/orchestrate-2026-09-003-abc.mp4";

function seed(db: Database): void {
  db.run(
    `INSERT INTO content_plans (month, start_date, end_date, timezone, created_at)
     VALUES ('2026-09','2026-09-01','2026-09-30','Europe/London','2026-08-30T00:00:00Z')`,
  );
  // An older plan to confirm latestPlan / overview pick the newest month.
  db.run(
    `INSERT INTO content_plans (month, start_date, end_date, timezone, created_at)
     VALUES ('2026-08','2026-08-01','2026-08-31','Europe/London','2026-07-30T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO plan_slots (id, month, slot_date, slot_time, format, source, topic, brand_fit, hook, why, assets, created_at)
     VALUES ('2026-09-003','2026-09','2026-09-03','09:00','Short','events','Rosh Hashanah',80,'hook','why',NULL,'2026-08-30T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO plan_slots (id, month, slot_date, slot_time, format, source, topic, brand_fit, hook, why, assets, created_at)
     VALUES ('2026-08-001','2026-08','2026-08-01','09:00','Short','events','August thing',50,NULL,NULL,NULL,'2026-07-30T00:00:00Z')`,
  );
  const review = {
    decision: "PASS",
    englishMeaning: "hello",
    brandVoice: "witty",
    issues: [],
    productClaims: [],
    coverage: "all",
    uncertainty: "none",
    nextStep: "render",
  };
  db.run(
    `INSERT INTO scripts (slot_id, title, scene_prompt, dialogue, duration_seconds, video_prompt, decision, review_json, revisions, created_at, updated_at)
     VALUES ('2026-09-003','T','scene','line',5,'prompt','PASS',?,0,'2026-08-31T00:00:00Z','2026-08-31T00:00:00Z')`,
    [JSON.stringify(review)],
  );
  db.run(
    `INSERT INTO youtube_uploads (id, slot_id, title, privacy, youtube_video_id, status, error, created_at, updated_at)
     VALUES (?, '2026-09-003','T','unlisted','abc123','COMPLETED',NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`,
    [VIDEO_KEY],
  );
  db.run(
    `INSERT INTO video_jobs (id, provider, endpoint, request_id, status, input_json, output_path, seed, error, created_at, updated_at)
     VALUES ('job-1','higgsfield','wan','req-1','COMPLETED','{}',?,42,NULL,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`,
    [VIDEO_KEY],
  );
  db.run(
    `INSERT INTO event_ideas (id, scan_date, title, summary, event_date, end_date, source, source_url, country, brand_fit, reason, suggested_format, window_earliest, window_latest, created_at)
     VALUES ('ev-1','2026-08-25','Rosh Hashanah','desc','2026-09-03',NULL,'calendar','https://x','GB',80,'fits','Short',NULL,NULL,'2026-08-25T00:00:00Z')`,
  );
}

describe("DashboardReader", () => {
  it("joins the latest plan into an overview row", () => {
    const db = new SqliteDatabase(":memory:");
    createSchema(db);
    seed(db);
    const reader = new DashboardReader(db);

    const rows = reader.overview();
    expect(rows).toHaveLength(1); // only the latest month (2026-09)
    const r = rows[0];
    expect(r.slotId).toBe("2026-09-003");
    expect(r.scriptDecision).toBe("PASS");
    expect(r.videoStatus).toBe("COMPLETED");
    expect(r.uploadStatus).toBe("COMPLETED");
    expect(r.youtubeUrl).toBe("https://youtu.be/abc123");
    db.close();
  });

  it("reads plans, slots, scripts, videos and uploads", () => {
    const db = new SqliteDatabase(":memory:");
    createSchema(db);
    seed(db);
    const reader = new DashboardReader(db);

    expect(reader.latestPlan()?.month).toBe("2026-09");
    expect(reader.listPlans()).toHaveLength(2);
    expect(reader.listSlots("2026-09")).toHaveLength(1);
    expect(reader.getSlot("2026-09-003")?.topic).toBe("Rosh Hashanah");

    const script = reader.getScript("2026-09-003");
    expect(script?.decision).toBe("PASS");
    expect((script?.review as { decision: string }).decision).toBe("PASS");

    expect(reader.listVideoJobs()).toHaveLength(1);
    expect(reader.listUploads()).toHaveLength(1);
    expect(reader.getUpload("2026-09-003")?.url).toBe("https://youtu.be/abc123");

    const detail = reader.getSlotDetail("2026-09-003");
    expect(detail?.script?.decision).toBe("PASS");
    expect(detail?.video?.status).toBe("COMPLETED");
    expect(detail?.upload?.youtubeVideoId).toBe("abc123");

    expect(reader.listEvents()).toHaveLength(1);
    expect(reader.listEventScans()).toEqual([{ scanDate: "2026-08-25", count: 1 }]);
    db.close();
  });

  it("returns empty results when tables are missing", () => {
    const db = new SqliteDatabase(":memory:"); // no schema at all
    const reader = new DashboardReader(db);
    expect(reader.overview()).toEqual([]);
    expect(reader.listPlans()).toEqual([]);
    expect(reader.latestPlan()).toBeNull();
    expect(reader.listSlots()).toEqual([]);
    expect(reader.getSlot("x")).toBeNull();
    expect(reader.getScript("x")).toBeNull();
    expect(reader.listVideoJobs()).toEqual([]);
    expect(reader.listUploads()).toEqual([]);
    expect(reader.listEvents()).toEqual([]);
    expect(reader.listEventScans()).toEqual([]);
    db.close();
  });
});
