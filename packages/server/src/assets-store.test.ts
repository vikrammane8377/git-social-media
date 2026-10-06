import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { AssetsStore } from "./assets-store.js";

describe("AssetsStore", () => {
  it("creates, lists, gets, updates tags and removes", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new AssetsStore(db);
    store.init();

    const a = store.create(
      {
        id: "a1",
        storagePath: "assets/uploads/a1-cafe.png",
        filename: "cafe.png",
        mime: "image/png",
        tags: ["bix", "cafe"],
        description: "Cafe shot",
      },
      "2026-10-01T00:00:00Z",
    );
    expect(a.tags).toEqual(["bix", "cafe"]);

    store.create(
      {
        id: "a2",
        storagePath: "assets/uploads/a2-logo.png",
        filename: "logo.png",
        mime: "image/png",
        tags: ["logo"],
        description: "",
      },
      "2026-10-02T00:00:00Z",
    );

    // Newest first.
    const list = store.list();
    expect(list.map((r) => r.id)).toEqual(["a2", "a1"]);

    const got = store.get("a1");
    expect(got?.filename).toBe("cafe.png");
    expect(got?.description).toBe("Cafe shot");

    const updated = store.updateTags("a1", { tags: ["studio"], description: "Studio" });
    expect(updated?.tags).toEqual(["studio"]);
    expect(store.get("a1")?.description).toBe("Studio");

    // Partial update leaves the other field untouched.
    const partial = store.updateTags("a1", { description: "Just desc" });
    expect(partial?.tags).toEqual(["studio"]);

    expect(store.remove("a1")).toBe(true);
    expect(store.get("a1")).toBeUndefined();
    expect(store.remove("a1")).toBe(false);
    expect(store.list().map((r) => r.id)).toEqual(["a2"]);

    db.close();
  });

  it("returns undefined for a missing asset", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new AssetsStore(db);
    store.init();
    expect(store.get("nope")).toBeUndefined();
    expect(store.updateTags("nope", { tags: ["x"] })).toBeUndefined();
    expect(store.updateAnalysis("nope", { status: "done" })).toBeUndefined();
    db.close();
  });

  it("creates with a pending status and records the analysis later", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new AssetsStore(db);
    store.init();

    const created = store.create(
      {
        id: "a1",
        storagePath: "assets/uploads/a1-cafe.png",
        filename: "cafe.png",
        mime: "image/png",
        tags: ["cafe"],
        description: "",
        analysisStatus: "pending",
      },
      "2026-10-01T00:00:00Z",
    );
    expect(created.analysisStatus).toBe("pending");
    expect(created.analysis).toBe("");

    const updated = store.updateAnalysis("a1", {
      analysis: "A cosy cafe backdrop.",
      tags: ["cafe", "indoor"],
      status: "done",
    });
    expect(updated?.analysis).toBe("A cosy cafe backdrop.");
    expect(updated?.tags).toEqual(["cafe", "indoor"]);
    expect(updated?.analysisStatus).toBe("done");

    const got = store.get("a1");
    expect(got?.analysis).toBe("A cosy cafe backdrop.");
    expect(got?.analysisStatus).toBe("done");
  });

  it("defaults analysis fields to empty when not analysed", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new AssetsStore(db);
    store.init();
    const created = store.create({
      id: "a2",
      storagePath: "assets/uploads/a2-logo.png",
      filename: "logo.png",
      mime: "image/png",
      tags: [],
      description: "",
    });
    expect(created.analysis).toBe("");
    expect(created.analysisStatus).toBe("");
  });

  it("creates enabled by default and toggles with setEnabled", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new AssetsStore(db);
    store.init();

    const created = store.create({
      id: "a1",
      storagePath: "assets/uploads/a1.png",
      filename: "a1.png",
      mime: "image/png",
      tags: [],
      description: "",
    });
    expect(created.enabled).toBe(true);

    const off = store.setEnabled("a1", false);
    expect(off?.enabled).toBe(false);
    expect(store.get("a1")?.enabled).toBe(false);

    const on = store.setEnabled("a1", true);
    expect(on?.enabled).toBe(true);
    expect(store.get("a1")?.enabled).toBe(true);

    expect(store.setEnabled("nope", false)).toBeUndefined();

    db.close();
  });

  it("migrates a pre-existing assets table that lacks the enabled column", () => {
    const db = new SqliteDatabase(":memory:");
    // Older DB created before the enabled column existed.
    db.exec(`
      CREATE TABLE assets (
        id              TEXT PRIMARY KEY,
        storage_path    TEXT NOT NULL,
        filename        TEXT NOT NULL,
        mime            TEXT NOT NULL,
        tags_json       TEXT NOT NULL,
        description     TEXT NOT NULL,
        analysis        TEXT NOT NULL DEFAULT '',
        analysis_status TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL
      )
    `);
    db.run(
      `INSERT INTO assets (id, storage_path, filename, mime, tags_json, description, created_at)
       VALUES ('old', 'assets/uploads/old.png', 'old.png', 'image/png', '["bix"]', '', '2026-01-01T00:00:00Z')`,
    );

    const store = new AssetsStore(db);
    store.init(); // should ALTER TABLE to add the enabled column (default 1)

    // Existing rows are enabled by default after the migration.
    expect(store.get("old")?.enabled).toBe(true);
    expect(store.setEnabled("old", false)?.enabled).toBe(false);
    expect(store.get("old")?.enabled).toBe(false);

    db.close();
  });

  it("migrates a pre-existing assets table that lacks the analysis columns", () => {
    const db = new SqliteDatabase(":memory:");
    // Simulate an older DB created before analysis/analysis_status existed.
    db.exec(`
      CREATE TABLE assets (
        id           TEXT PRIMARY KEY,
        storage_path TEXT NOT NULL,
        filename     TEXT NOT NULL,
        mime         TEXT NOT NULL,
        tags_json    TEXT NOT NULL,
        description  TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )
    `);
    db.run(
      `INSERT INTO assets (id, storage_path, filename, mime, tags_json, description, created_at)
       VALUES ('old', 'assets/uploads/old.png', 'old.png', 'image/png', '["bix"]', '', '2026-01-01T00:00:00Z')`,
    );

    const store = new AssetsStore(db);
    store.init(); // should ALTER TABLE to add the analysis columns

    const got = store.get("old");
    expect(got?.analysis).toBe("");
    expect(got?.analysisStatus).toBe("");

    const updated = store.updateAnalysis("old", { analysis: "Legacy image.", status: "done" });
    expect(updated?.analysis).toBe("Legacy image.");
    expect(store.get("old")?.analysisStatus).toBe("done");

    db.close();
  });
});
