import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { SqliteDatabase, LocalFileStorage, type Database } from "@bix/storage";
import { createApp } from "./app.js";
import { DashboardReader } from "./read.js";
import { MediaService } from "./media.js";
import { RunsStore } from "./runs-store.js";
import { AssetsStore } from "./assets-store.js";
import { JobManager, type SpawnFn } from "./jobs.js";

function schemaAndSeed(db: Database): void {
  db.exec(`CREATE TABLE content_plans (month TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, timezone TEXT, created_at TEXT)`);
  db.exec(`CREATE TABLE plan_slots (id TEXT PRIMARY KEY, month TEXT, slot_date TEXT, slot_time TEXT, channel TEXT, format TEXT, source TEXT, topic TEXT, brand_fit INTEGER, hook TEXT, why TEXT, assets TEXT, created_at TEXT)`);
  db.run(`INSERT INTO content_plans VALUES ('2026-09','2026-09-01','2026-09-30','UTC','t')`);
  db.run(`INSERT INTO plan_slots VALUES ('2026-09-003','2026-09','2026-09-03','09:00','spanish','Short','events','Topic',80,NULL,NULL,NULL,'t')`);
}

/** Create the scripts table and insert one row carrying the given assets_used. */
function seedScript(db: Database, slotId: string, assetsUsed: string[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS scripts (
    slot_id TEXT PRIMARY KEY, title TEXT, scene_prompt TEXT NOT NULL, dialogue TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL, video_prompt TEXT NOT NULL, decision TEXT NOT NULL,
    review_json TEXT NOT NULL, revisions INTEGER NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, assets_used TEXT NOT NULL DEFAULT '[]')`);
  db.run(
    `INSERT OR REPLACE INTO scripts
      (slot_id, title, scene_prompt, dialogue, duration_seconds, video_prompt,
       decision, review_json, revisions, created_at, updated_at, assets_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [slotId, "T", "scene", "line", 5, "prompt", "PASS", "{}", 0, "t", "t", JSON.stringify(assetsUsed)],
  );
}

/** A fake spawn that emits one stdout line then closes with the given code. */
function fakeSpawn(code = 0): SpawnFn {
  return () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => {
      child.stdout.emit("data", "working\n");
      child.emit("close", code);
    }, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return child as any;
  };
}

describe("createApp (Phase 1)", () => {
  let base: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bix-app-"));
    db = new SqliteDatabase(":memory:");
    schemaAndSeed(db);
  });

  afterEach(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      reader: new DashboardReader(db),
      media: new MediaService(new LocalFileStorage(base)),
      root: base,
    });
  }

  it("GET /api/overview returns joined rows", async () => {
    const res = await app().request("/api/overview");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(1);
  });

  it("GET /api/health returns env + oauth", async () => {
    const res = await app().request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { env: unknown; oauth: unknown };
    expect(body.env).toBeDefined();
    expect(body.oauth).toBeDefined();
  });

  it("returns 404 for an unknown slot", async () => {
    const res = await app().request("/api/slots/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("path-guards the report endpoint", async () => {
    const res = await app().request("/api/report?key=secrets/env.md");
    expect(res.status).toBe(403);
  });
});

describe("createApp (Phase 2 triggers)", () => {
  let base: string;
  let db: SqliteDatabase;
  let runsStore: RunsStore;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bix-app2-"));
    db = new SqliteDatabase(":memory:");
    schemaAndSeed(db);
    runsStore = new RunsStore(db);
    runsStore.init();
  });

  afterEach(async () => {
    // Let any pending fake-child timers finalize their run before the DB closes.
    await new Promise((r) => setTimeout(r, 5));
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  function app(code = 0) {
    const jobs = new JobManager({ store: runsStore, root: base, spawn: fakeSpawn(code) });
    return createApp({
      reader: new DashboardReader(db),
      media: new MediaService(new LocalFileStorage(base)),
      root: base,
      jobs,
      runsStore,
    });
  }

  it("starts a script run without confirm", async () => {
    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "script", slotId: "2026-09-003" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toBeTruthy();
  });

  it("refuses a spending action without confirm", async () => {
    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "orchestrate", slotId: "2026-09-003" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/confirm/);
  });

  it("refuses a spending action when the OAuth token is missing", async () => {
    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "generate", slotId: "2026-09-003", confirm: true }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/[Nn]eeds login/);
  });

  it("allows a spending action once the token is present", async () => {
    // Write a fake higgsfield token so isLoggedIn passes.
    mkdirSync(join(base, "data"), { recursive: true });
    writeFileSync(
      join(base, "data", "higgsfield-tokens.json"),
      JSON.stringify({ accessToken: "x", expiresAt: Date.now() + 60000 }),
    );
    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "generate", slotId: "2026-09-003", confirm: true }),
    });
    expect(res.status).toBe(201);
  });

  it("resolves the script's chosen assets into --ref args for generate", async () => {
    mkdirSync(join(base, "data"), { recursive: true });
    writeFileSync(
      join(base, "data", "higgsfield-tokens.json"),
      JSON.stringify({ accessToken: "x", expiresAt: Date.now() + 60000 }),
    );
    seedScript(db, "2026-09-003", ["assets/uploads/one.png", "assets/uploads/two.png"]);

    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "generate", slotId: "2026-09-003", confirm: true }),
    });
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { argsJson: string } };
    const args = JSON.parse(run.argsJson) as string[];
    expect(args).toContain("--ref");
    expect(args).toContain(join(base, "assets/uploads/one.png"));
    expect(args).toContain(join(base, "assets/uploads/two.png"));
  });

  it("rejects an unknown kind", async () => {
    const res = await app().request("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "delete-everything", slotId: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("createApp assets", () => {
  let base: string;
  let db: SqliteDatabase;
  let assetsStore: AssetsStore;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "bix-assets-"));
    db = new SqliteDatabase(":memory:");
    schemaAndSeed(db);
    assetsStore = new AssetsStore(db);
    assetsStore.init();
  });

  afterEach(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  function app() {
    const storage = new LocalFileStorage(base);
    return createApp({
      reader: new DashboardReader(db),
      media: new MediaService(storage),
      root: base,
      assetsStore,
      storage,
    });
  }

  it("uploads, lists, serves the file, then deletes", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "cafe.png", { type: "image/png" }));
    form.append("tags", "bix,cafe");
    form.append("description", "A cafe shot");

    const created = await app().request("/api/assets", { method: "POST", body: form });
    expect(created.status).toBe(201);
    const { asset } = (await created.json()) as { asset: { id: string; tags: string[] } };
    expect(asset.tags).toEqual(["bix", "cafe"]);

    const listed = await app().request("/api/assets");
    const { assets } = (await listed.json()) as { assets: unknown[] };
    expect(assets).toHaveLength(1);

    const fileRes = await app().request(`/api/assets/${asset.id}/file`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("Content-Type")).toBe("image/png");

    const del = await app().request(`/api/assets/${asset.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const after = await app().request(`/api/assets/${asset.id}/file`);
    expect(after.status).toBe(404);
  });

  it("rejects a non-image upload", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0])], "notes.txt", { type: "text/plain" }));
    const res = await app().request("/api/assets", { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  it("runs the vision analyzer in the background and merges its tags", async () => {
    // A fake analyzer that reports a cafe scene and suggests one extra tag.
    const analyzer = {
      async analyze() {
        return { analysis: "A cosy cafe backdrop for Bix's coffee lessons.", tags: ["indoor"] };
      },
    };
    const storage = new LocalFileStorage(base);
    const withAnalyzer = createApp({
      reader: new DashboardReader(db),
      media: new MediaService(storage),
      root: base,
      assetsStore,
      storage,
      assetAnalyzer: analyzer,
    });

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "cafe.png", { type: "image/png" }));
    form.append("tags", "cafe");
    form.append("description", "A cafe shot");

    const created = await withAnalyzer.request("/api/assets", { method: "POST", body: form });
    expect(created.status).toBe(201);
    const { asset } = (await created.json()) as { asset: { id: string; analysisStatus: string } };
    // Upload returns immediately with a pending status.
    expect(asset.analysisStatus).toBe("pending");

    // Poll until the fire-and-forget background job records the analysis.
    let record = assetsStore.get(asset.id);
    for (let i = 0; i < 50 && record?.analysisStatus === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 10));
      record = assetsStore.get(asset.id);
    }
    expect(record?.analysisStatus).toBe("done");
    expect(record?.analysis).toContain("cosy cafe backdrop");
    // Uploader tags come first, de-duped, with the AI's suggestion appended.
    expect(record?.tags).toEqual(["cafe", "indoor"]);
  });

  it("leaves analysisStatus empty when no analyzer is configured", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "logo.png", { type: "image/png" }));
    const created = await app().request("/api/assets", { method: "POST", body: form });
    const { asset } = (await created.json()) as { asset: { analysisStatus: string } };
    expect(asset.analysisStatus).toBe("");
  });
});

describe("createApp auth seam", () => {
  it("requires a bearer token when DASHBOARD_TOKEN is configured", async () => {
    const db = new SqliteDatabase(":memory:");
    schemaAndSeed(db);
    const base = mkdtempSync(join(tmpdir(), "bix-auth-"));
    const app = createApp({
      reader: new DashboardReader(db),
      media: new MediaService(new LocalFileStorage(base)),
      root: base,
      authToken: "s3cret",
    });
    const denied = await app.request("/api/overview");
    expect(denied.status).toBe(401);
    const ok = await app.request("/api/overview", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(ok.status).toBe(200);
    db.close();
    rmSync(base, { recursive: true, force: true });
  });
});
