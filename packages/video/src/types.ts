/**
 * Provider-agnostic types for video generation. The rest of the app codes
 * against these so we can swap fal for another provider later without touching
 * the runner, job store or CLI.
 */

/** The generation request, in provider-neutral terms. */
export interface VideoJobInput {
  /** Text prompt describing the clip. Must never ask for on-screen text/captions/signs. */
  readonly prompt: string;
  /** URLs of already-uploaded reference images. */
  readonly imageUrls: readonly string[];
  /**
   * When true, every uploaded image is passed as a plain reference (the model's
   * `reference_image` role / `image_references`) with NO first-frame
   * `start_image`. Wan rejects a `start_image` combined with reference media, so
   * reference-only generations (e.g. the branded outro) set this. Default/false
   * keeps the legacy behaviour: the first image is the `start_image`.
   */
  readonly referencesOnly?: boolean;
  /** "480p" | "720p" | "1080p". */
  readonly resolution: string;
  /** e.g. "9:16", "16:9", "auto". */
  readonly aspectRatio: string;
  /** Seconds (4-30) or "auto". */
  readonly duration: number | string;
  /** Whether the model should generate synchronised audio. */
  readonly generateAudio: boolean;
  /**
   * Talking-avatar providers only: the line the character speaks. The provider
   * converts this text to speech and lip-syncs it (no separate audio file).
   */
  readonly textInput?: string;
  /** Talking-avatar providers only: the built-in TTS voice name. */
  readonly voice?: string;
  /** Talking-avatar providers only: number of frames, which controls length. */
  readonly numFrames?: number;
}

/** The lifecycle state of a submitted job, normalised across providers. */
export type VideoStatusState = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export interface VideoStatus {
  readonly state: VideoStatusState;
  /** Provider-specific raw payload, for logging/debugging. */
  readonly raw?: unknown;
}

export interface VideoResult {
  readonly videoUrl: string;
  readonly seed?: number;
}

/**
 * A video-generation provider. Split into discrete steps (upload, submit,
 * status, result) so the runner can persist the request id immediately after
 * submit and resume polling later.
 */
export interface VideoProvider {
  /** Stable identifier for logs and the job record. */
  readonly name: string;
  /** The provider endpoint id (e.g. the fal model path). */
  readonly endpointId: string;
  /** Upload one reference image and return a URL usable in {@link VideoJobInput}. */
  uploadReferenceImage(localPath: string): Promise<string>;
  /** Submit a job. Returns the provider request id. */
  submit(input: VideoJobInput): Promise<{ requestId: string }>;
  /** Check the current status of a submitted request. */
  status(requestId: string): Promise<VideoStatus>;
  /** Fetch the final result for a completed request. */
  result(requestId: string): Promise<VideoResult>;
}
