import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { VideoJobStore } from "./job-store.js";

function newStore(): VideoJobStore {
  const store = new VideoJobStore(new SqliteDatabase(":memory:"));
  store.init();
  return store;
}

describe("VideoJobStore", () => {
  it("creates and reads back a job", () => {
    const store = newStore();
    store.create({
      id: "job1",
      provider: "test",
      endpoint: "ep",
      requestId: "req-1",
      status: "SUBMITTED",
      inputJson: "{}",
      outputPath: null,
      seed: null,
      error: null,
    });

    const got = store.get("job1");
    expect(got?.requestId).toBe("req-1");
    expect(got?.status).toBe("SUBMITTED");
  });

  it("returns undefined for an unknown job", () => {
    expect(newStore().get("nope")).toBeUndefined();
  });

  it("patches only the given fields", () => {
    const store = newStore();
    store.create({
      id: "job1",
      provider: "test",
      endpoint: "ep",
      requestId: "req-1",
      status: "SUBMITTED",
      inputJson: "{}",
      outputPath: null,
      seed: null,
      error: null,
    });

    store.update("job1", { status: "COMPLETED", outputPath: "outputs/x.mp4", seed: 42 });
    const got = store.get("job1");
    expect(got?.status).toBe("COMPLETED");
    expect(got?.outputPath).toBe("outputs/x.mp4");
    expect(got?.seed).toBe(42);
    expect(got?.requestId).toBe("req-1"); // untouched
  });
});
