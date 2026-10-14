import type { FileStorage } from "@bix/storage";
import type { VideoProvider, VideoJobInput } from "./types.js";
import { VideoJobStore } from "./job-store.js";
import { computeJobKey } from "./job-key.js";

/** A request as expressed by the CLI, before reference images are uploaded. */
export interface VideoRequest {
  readonly prompt: string;
  readonly refImagePaths: readonly string[];
  /** Pass all reference images as plain references with no first-frame start_image. */
  readonly referencesOnly?: boolean;
  readonly resolution: string;
  readonly aspectRatio: string;
  readonly duration: number | string;
  readonly generateAudio: boolean;
  /** Talking-avatar providers only: the line the character speaks. */
  readonly textInput?: string;
  /** Talking-avatar providers only: the built-in TTS voice name. */
  readonly voice?: string;
  /** Talking-avatar providers only: number of frames (controls length). */
  readonly numFrames?: number;
  /** Short label used in the output filename (e.g. the prompt file's base name). */
  readonly label: string;
}

export interface RunnerDeps {
  readonly provider: VideoProvider;
  readonly store: VideoJobStore;
  readonly fileStorage: FileStorage;
  /** Download a completed video to a Buffer. Defaults to global fetch. */
  readonly download?: (url: string) => Promise<Buffer>;
  /** Sleep between status polls. Defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly logger?: (message: string) => void;
}

export interface RunResult {
  readonly jobId: string;
  readonly requestId: string;
  readonly outputPath: string;
  /** True when an existing submitted/completed job was picked up rather than freshly submitted. */
  readonly resumed: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_POLLS = 240; // ~20 min at 5s

async function defaultDownload(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download video (${res.status} ${res.statusText}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Orchestrates one video generation with resumability:
 *  - identical inputs map to the same job id,
 *  - the provider request id is saved immediately after submit,
 *  - a rerun resumes polling/download for an in-flight request instead of
 *    submitting a new one.
 */
export class VideoRunner {
  private readonly provider: VideoProvider;
  private readonly store: VideoJobStore;
  private readonly fileStorage: FileStorage;
  private readonly download: (url: string) => Promise<Buffer>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly log: (message: string) => void;

  constructor(deps: RunnerDeps) {
    this.provider = deps.provider;
    this.store = deps.store;
    this.fileStorage = deps.fileStorage;
    this.download = deps.download ?? defaultDownload;
    this.sleep = deps.sleep ?? defaultSleep;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;
    this.log = deps.logger ?? ((m) => console.log(m));
  }

  async generate(request: VideoRequest): Promise<RunResult> {
    this.store.init();

    const jobId = computeJobKey({
      endpoint: this.provider.endpointId,
      prompt: request.prompt,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      duration: request.duration,
      generateAudio: request.generateAudio,
      refImagePaths: request.refImagePaths,
      textInput: request.textInput,
      voice: request.voice,
      numFrames: request.numFrames,
    });

    const outputPath = `outputs/video/${request.label}-${jobId.slice(0, 8)}.mp4`;
    const existing = this.store.get(jobId);

    // Already finished and the file is still on disk: nothing to do.
    if (
      existing?.status === "COMPLETED" &&
      existing.outputPath &&
      this.fileStorage.exists(existing.outputPath)
    ) {
      this.log(`Job ${jobId.slice(0, 8)} already completed: ${existing.outputPath}`);
      return {
        jobId,
        requestId: existing.requestId ?? "",
        outputPath: existing.outputPath,
        resumed: true,
      };
    }

    let requestId = existing?.requestId ?? null;
    let resumed = false;

    if (requestId) {
      // A previous run already submitted this job; resume it.
      resumed = true;
      this.log(`Resuming existing request ${requestId} for job ${jobId.slice(0, 8)}.`);
    } else {
      // Fresh job: upload references, submit, and persist the request id at once.
      this.log(`Uploading ${request.refImagePaths.length} reference image(s)...`);
      const imageUrls: string[] = [];
      for (const p of request.refImagePaths) {
        imageUrls.push(await this.provider.uploadReferenceImage(p));
      }

      const input: VideoJobInput = {
        prompt: request.prompt,
        imageUrls,
        referencesOnly: request.referencesOnly,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        duration: request.duration,
        generateAudio: request.generateAudio,
        textInput: request.textInput,
        voice: request.voice,
        numFrames: request.numFrames,
      };

      this.log("Submitting job to provider...");
      const submitted = await this.provider.submit(input);
      requestId = submitted.requestId;

      // Save the request id immediately, before any polling.
      this.store.create({
        id: jobId,
        provider: this.provider.name,
        endpoint: this.provider.endpointId,
        requestId,
        status: "SUBMITTED",
        inputJson: JSON.stringify(input),
        outputPath: null,
        seed: null,
        error: null,
      });
      this.log(`Submitted. Saved request id ${requestId} (job ${jobId.slice(0, 8)}).`);
    }

    try {
      await this.pollUntilComplete(jobId, requestId);

      const result = await this.provider.result(requestId);
      this.log("Downloading MP4...");
      const buffer = await this.download(result.videoUrl);
      this.fileStorage.write(outputPath, buffer);

      this.store.update(jobId, {
        status: "COMPLETED",
        outputPath,
        seed: result.seed ?? null,
        error: null,
      });
      this.log(`Done. Saved ${outputPath}`);

      return { jobId, requestId, outputPath, resumed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.update(jobId, { status: "FAILED", error: message });
      throw err;
    }
  }

  private async pollUntilComplete(jobId: string, requestId: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPolls; attempt++) {
      const status = await this.provider.status(requestId);
      if (status.state === "COMPLETED") {
        this.store.update(jobId, { status: "IN_PROGRESS" });
        return;
      }
      this.store.update(jobId, { status: "IN_PROGRESS" });
      this.log(`Status: ${status.state} (poll ${attempt + 1}/${this.maxPolls})`);
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(
      `Timed out after ${this.maxPolls} status checks. Request ${requestId} is still running; rerun to resume.`,
    );
  }
}
