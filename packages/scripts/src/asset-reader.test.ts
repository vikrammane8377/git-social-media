import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { AssetReader } from "./asset-reader.js";

function seed(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE assets (
      id           TEXT PRIMARY KEY,
      storage_path TEXT NOT NULL,
      filename     TEXT NOT NULL,
      mime         TEXT NOT NULL,
      tags_json    TEXT NOT NULL,
      description  TEXT,
      created_at   TEXT NOT NULL
    )
  `);
  const insert = (
    id: string,
    path: string,
    filename: string,
    tags: string[],
    description: string | null,
    createdAt: string,
  ): void => {
    db.run(
      `INSERT INTO assets (id, storage_path, filename, mime, tags_json, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, path, filename, "image/png", JSON.stringify(tags), description, createdAt],
    );
  };
  insert("1", "assets/uploads/1-a.png", "a.png", ["bix", "cafe"], "Cafe shot", "2026-10-01T00:00:00Z");
  insert("2", "assets/uploads/2-b.png", "b.png", ["logo"], null, "2026-10-02T00:00:00Z");
}

describe("AssetReader", () => {
  it("returns [] when the assets table does not exist", () => {
    const db = new SqliteDatabase(":memory:");
    const reader = new AssetReader(db);
    expect(reader.list()).toEqual([]);
    expect(reader.byKeys(["assets/uploads/1-a.png"])).toEqual([]);
    db.close();
  });

  it("lists assets newest first with parsed tags", () => {
    const db = new SqliteDatabase(":memory:");
    seed(db);
    const reader = new AssetReader(db);

    const all = reader.list();
    expect(all.map((a) => a.key)).toEqual(["assets/uploads/2-b.png", "assets/uploads/1-a.png"]);
    expect(all[1].tags).toEqual(["bix", "cafe"]);
    expect(all[1].description).toBe("Cafe shot");
    expect(all[0].description).toBe(""); // null → ""

    db.close();
  });

  it("byKeys resolves keys in input order and skips unknowns", () => {
    const db = new SqliteDatabase(":memory:");
    seed(db);
    const reader = new AssetReader(db);

    const got = reader.byKeys([
      "assets/uploads/1-a.png",
      "assets/uploads/missing.png",
      "assets/uploads/2-b.png",
    ]);
    expect(got.map((a) => a.key)).toEqual(["assets/uploads/1-a.png", "assets/uploads/2-b.png"]);

    db.close();
  });

  it("includes every row when the table has no enabled column (old DB)", () => {
    const db = new SqliteDatabase(":memory:");
    seed(db); // seed() creates the table without an enabled column
    const reader = new AssetReader(db);
    expect(reader.list().map((a) => a.key)).toEqual([
      "assets/uploads/2-b.png",
      "assets/uploads/1-a.png",
    ]);
    db.close();
  });

  it("excludes disabled assets from list() and byKeys()", () => {
    const db = new SqliteDatabase(":memory:");
    db.exec(`
      CREATE TABLE assets (
        id           TEXT PRIMARY KEY,
        storage_path TEXT NOT NULL,
        filename     TEXT NOT NULL,
        mime         TEXT NOT NULL,
        tags_json    TEXT NOT NULL,
        description  TEXT,
        created_at   TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1
      )
    `);
    const insert = (id: string, path: string, enabled: number): void => {
      db.run(
        `INSERT INTO assets (id, storage_path, filename, mime, tags_json, description, created_at, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, path, `${id}.png`, "image/png", "[]", null, `2026-10-0${id}T00:00:00Z`, enabled],
      );
    };
    insert("1", "assets/uploads/1-on.png", 1);
    insert("2", "assets/uploads/2-off.png", 0);

    const reader = new AssetReader(db);
    expect(reader.list().map((a) => a.key)).toEqual(["assets/uploads/1-on.png"]);
    expect(reader.byKeys(["assets/uploads/2-off.png"])).toEqual([]);

    db.close();
  });
});
