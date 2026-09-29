import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import { VideoJobStore } from "./job-store.js";
import { VideoRunner, type VideoRequest } from "./runner.js";
import type { VideoProvider, VideoJobInput, VideoStatus, VideoResult } from "./types.js";

/** A provider that records how often it uploads/submits, so tests can prove
 *  a resumed job does not re-upload or re-submit. */
class MockProvider implements VideoProvider {
  readonly name = "mock";
  readonly endpointId = "mock/endpoint";
  uploadCount = 0;
  submitCount = 0;
  private counter = 0;

  async uploadReferenceImage(): Promise<string> {
    this.uploadCount++;
    return `https://mock/upload/${this.uploadCount}.png`;
  }

  async submit(_input: VideoJobInput): Promise<{ requestId: string }> {
    this.submitCount++;
    return { requestId: `req-${++this.counter}` };
  }

  async status(_requestId: string): Promise<VideoStatus> {
    return { state: "COMPLETED" };
  }

  async result(_requestId: string): Promise<VideoResult> {
    return { videoUrl: "https://mock/video.mp4", seed: 7 };
  }
}

describe("VideoRunner", () => {
  let dir: string;
  let dbPath: string;
  let ref: string;
  let request: VideoRequest;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bix-runner-"));
    dbPath = join(dir, "jobs.db");
    ref = join(dir, "ref.png");
    writeFileSync(ref, "image-bytes");
    request = {
      prompt: "hello bix",
      refImagePaths: [ref],
      resolution: "720p",
      aspectRatio: "9:16",
      duration: 5,
      generateAudio: true,
      label: "test-01",
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const silent = () => {};

  it("submits, polls, downloads and saves the MP4 on a fresh run", async () => {
    const provider = new MockProvider();
    const store = new VideoJobStore(new SqliteDatabase(dbPath));
    const fileStorage = new LocalFileStorage(dir);
    const runner = new VideoRunner({
      provider,
      store,
      fileStorage,
      download: async () => Buffer.from("MP4DATA"),
      sleep: async () => {},
      pollIntervalMs: 0,
      logger: silent,
    });

    const result = await runner.generate(request);

    expect(provider.submitCount).toBe(1);
    expect(provider.uploadCount).toBe(1);
    expect(result.resumed).toBe(false);
    expect(fileStorage.exists(result.outputPath)).toBe(true);
    expect(fileStorage.read(result.outputPath).toString()).toBe("MP4DATA");
  });

  it("resumes an interrupted job instead of resubmitting", async () => {
    const provider = new MockProvider();

    // First run: submit succeeds (request id saved), then the download fails,
    // simulating a crash after submission but before completion.
    const store1 = new VideoJobStore(new SqliteDatabase(dbPath));
    const runner1 = new VideoRunner({
      provider,
      store: store1,
      fileStorage: new LocalFileStorage(dir),
      download: async () => {
        throw new Error("simulated interruption");
      },
      sleep: async () => {},
      pollIntervalMs: 0,
      logger: silent,
    });

    await expect(runner1.generate(request)).rejects.toThrow("simulated interruption");
    expect(provider.submitCount).toBe(1);

    // The request id must have been persisted.
    const saved = store1.get(
      (await import("./job-key.js")).computeJobKey({
        endpoint: provider.endpointId,
        prompt: request.prompt,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        duration: request.duration,
        generateAudio: request.generateAudio,
        refImagePaths: request.refImagePaths,
      }),
    );
    expect(saved?.requestId).toBe("req-1");

    // Second run: a brand-new store on the SAME db file (a real restart).
    const store2 = new VideoJobStore(new SqliteDatabase(dbPath));
    const fileStorage2 = new LocalFileStorage(dir);
    const runner2 = new VideoRunner({
      provider,
      store: store2,
      fileStorage: fileStorage2,
      download: async () => Buffer.from("MP4DATA"),
      sleep: async () => {},
      pollIntervalMs: 0,
      logger: silent,
    });

    const result = await runner2.generate(request);

    // Proof: it resumed the saved request rather than submitting a new one.
    expect(provider.submitCount).toBe(1);
    expect(provider.uploadCount).toBe(1);
    expect(result.resumed).toBe(true);
    expect(result.requestId).toBe("req-1");
    expect(fileStorage2.exists(result.outputPath)).toBe(true);
  });

  it("does nothing when the job is already completed and the file exists", async () => {
    const provider = new MockProvider();
    const store = new VideoJobStore(new SqliteDatabase(dbPath));
    const fileStorage = new LocalFileStorage(dir);
    const deps = {
      provider,
      store,
      fileStorage,
      download: async () => Buffer.from("MP4DATA"),
      sleep: async () => {},
      pollIntervalMs: 0,
      logger: silent,
    };

    await new VideoRunner(deps).generate(request);
    expect(provider.submitCount).toBe(1);

    // Rerun with the same inputs: should short-circuit, no new submit/upload.
    const result = await new VideoRunner(deps).generate(request);
    expect(provider.submitCount).toBe(1);
    expect(provider.uploadCount).toBe(1);
    expect(result.resumed).toBe(true);
  });
});
