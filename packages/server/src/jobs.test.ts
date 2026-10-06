import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { SqliteDatabase } from "@bix/storage";
import { RunsStore } from "./runs-store.js";
import { JobManager, buildCliArgs, type SpawnFn, type RunEvent } from "./jobs.js";

/** A controllable fake child process. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function makeManager(child: FakeChild, code?: number) {
  const db = new SqliteDatabase(":memory:");
  const store = new RunsStore(db);
  store.init();
  let captured: { command: string; args: readonly string[] } | null = null;
  const spawn: SpawnFn = (command, args) => {
    captured = { command, args };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return child as any;
  };
  const jobs = new JobManager({ store, root: "/repo", spawn, mode: "dev" });
  return { db, store, jobs, getCaptured: () => captured, code };
}

describe("buildCliArgs", () => {
  it("maps each kind to CLI argv", () => {
    expect(buildCliArgs("script", { slotId: "s1" })).toEqual(["script", "--slot", "s1"]);
    expect(buildCliArgs("generate", { slotId: "s1", promptFile: "outputs/scripts/prompt-s1.md" })).toEqual([
      "video",
      "--provider",
      "wan",
      "--prompt-file",
      "outputs/scripts/prompt-s1.md",
      "--ref",
      "assets/bix_stand.png",
    ]);
    expect(buildCliArgs("publish", { slotId: "s1", file: "outputs/video/x.mp4" })).toEqual([
      "youtube",
      "upload",
      "--file",
      "outputs/video/x.mp4",
      "--slot",
      "s1",
      "--privacy",
      "public",
    ]);
    expect(buildCliArgs("orchestrate", { slotId: "s1", privacy: "private" })).toEqual([
      "orchestrate",
      "--slot",
      "s1",
      "--privacy",
      "private",
    ]);
  });
});

describe("JobManager", () => {
  it("captures stdout line-by-line and finishes SUCCEEDED", async () => {
    const child = new FakeChild();
    const { db, store, jobs, getCaptured } = makeManager(child);

    const events: RunEvent[] = [];
    const run = jobs.start("script", { slotId: "s1" });
    jobs.subscribe(run.id, (e) => events.push(e));

    // dev mode spawns via npx tsx.
    expect(getCaptured()?.command).toBe("npx");
    expect(getCaptured()?.args).toContain("script");

    child.stdout.emit("data", "hello ");
    child.stdout.emit("data", "world\nsecond line\n");
    child.emit("close", 0);
    await new Promise((r) => setTimeout(r, 0));

    const fetched = store.get(run.id);
    expect(fetched?.status).toBe("SUCCEEDED");
    expect(fetched?.exitCode).toBe(0);
    expect(fetched?.log).toBe("hello world\nsecond line\n");

    const logLines = events.filter((e) => e.type === "log");
    expect(logLines).toEqual([
      { type: "log", line: "hello world" },
      { type: "log", line: "second line" },
    ]);
    expect(events.at(-1)).toEqual({ type: "status", status: "SUCCEEDED", exitCode: 0 });
    db.close();
  });

  it("marks FAILED on a non-zero exit and flushes trailing output", async () => {
    const child = new FakeChild();
    const { db, store, jobs } = makeManager(child);
    const run = jobs.start("script", { slotId: "s1" });

    child.stderr.emit("data", "boom (no newline)");
    child.emit("close", 2);
    await new Promise((r) => setTimeout(r, 0));

    const fetched = store.get(run.id);
    expect(fetched?.status).toBe("FAILED");
    expect(fetched?.exitCode).toBe(2);
    expect(fetched?.log).toBe("boom (no newline)\n");
    db.close();
  });

  it("handles a spawn error as a failed run", async () => {
    const child = new FakeChild();
    const { db, store, jobs } = makeManager(child);
    const run = jobs.start("script", { slotId: "s1" });

    child.emit("error", new Error("ENOENT"));
    await new Promise((r) => setTimeout(r, 0));

    const fetched = store.get(run.id);
    expect(fetched?.status).toBe("FAILED");
    expect(fetched?.log).toMatch(/ENOENT/);
    db.close();
  });
});
