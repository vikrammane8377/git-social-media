import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { RunsStore } from "./runs-store.js";

describe("RunsStore", () => {
  it("creates, appends log, finishes, gets and lists", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new RunsStore(db);
    store.init();

    const run = store.create({
      id: "run-1",
      kind: "script",
      slotId: "2026-09-003",
      args: ["script", "--slot", "2026-09-003"],
    });
    expect(run.status).toBe("RUNNING");
    expect(run.log).toBe("");

    store.appendLog("run-1", "line one\n");
    store.appendLog("run-1", "line two\n");
    let fetched = store.get("run-1");
    expect(fetched?.log).toBe("line one\nline two\n");
    expect(fetched?.status).toBe("RUNNING");

    store.finish("run-1", "SUCCEEDED", 0);
    fetched = store.get("run-1");
    expect(fetched?.status).toBe("SUCCEEDED");
    expect(fetched?.exitCode).toBe(0);
    expect(fetched?.endedAt).toBeTruthy();

    store.create({ id: "run-2", kind: "orchestrate", slotId: null, args: ["orchestrate"] });
    const list = store.list();
    expect(list).toHaveLength(2);
    db.close();
  });

  it("returns undefined for a missing run", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new RunsStore(db);
    store.init();
    expect(store.get("nope")).toBeUndefined();
    db.close();
  });
});
