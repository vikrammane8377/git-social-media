import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "./db.js";

describe("SqliteDatabase", () => {
  it("creates tables, writes and reads back rows", () => {
    const db = new SqliteDatabase(":memory:");
    db.exec("CREATE TABLE ideas (id INTEGER PRIMARY KEY, topic TEXT)");

    const res = db.run("INSERT INTO ideas (topic) VALUES (?)", ["Halloween"]);
    expect(res.changes).toBe(1);

    const row = db.get<{ id: number; topic: string }>(
      "SELECT id, topic FROM ideas WHERE topic = ?",
      ["Halloween"],
    );
    expect(row?.topic).toBe("Halloween");

    const all = db.all<{ topic: string }>("SELECT topic FROM ideas");
    expect(all).toHaveLength(1);

    db.close();
  });

  it("returns undefined when no row matches", () => {
    const db = new SqliteDatabase(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    expect(db.get("SELECT x FROM t WHERE x = ?", [99])).toBeUndefined();
    db.close();
  });
});
