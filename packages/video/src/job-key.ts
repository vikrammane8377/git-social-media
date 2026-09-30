import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** The inputs that define a unique video job. Two runs with identical inputs
 *  share a key, so a rerun resumes the saved request instead of resubmitting. */
export interface JobKeyInput {
  readonly endpoint: string;
  readonly prompt: string;
  readonly resolution: string;
  readonly aspectRatio: string;
  readonly duration: number | string;
  readonly generateAudio: boolean;
  readonly refImagePaths: readonly string[];
  /** Talking-avatar providers only; included in the key when present. */
  readonly textInput?: string;
  readonly voice?: string;
  readonly numFrames?: number;
}

/**
 * Compute a deterministic job key from the endpoint, parameters and the content
 * of each reference image. Hashing file content (not just the path) means a
 * changed image produces a new job, while an unchanged rerun resumes.
 */
export function computeJobKey(input: JobKeyInput): string {
  const hash = createHash("sha256");
  hash.update(`endpoint:${input.endpoint}\n`);
  hash.update(`prompt:${input.prompt}\n`);
  hash.update(`resolution:${input.resolution}\n`);
  hash.update(`aspect_ratio:${input.aspectRatio}\n`);
  hash.update(`duration:${String(input.duration)}\n`);
  hash.update(`generate_audio:${String(input.generateAudio)}\n`);
  // Talking-avatar fields only contribute when present, so existing image/video
  // job keys are unchanged.
  if (input.textInput !== undefined) hash.update(`text_input:${input.textInput}\n`);
  if (input.voice !== undefined) hash.update(`voice:${input.voice}\n`);
  if (input.numFrames !== undefined) hash.update(`num_frames:${String(input.numFrames)}\n`);
  for (const p of input.refImagePaths) {
    const content = readFileSync(p);
    const contentHash = createHash("sha256").update(content).digest("hex");
    hash.update(`ref:${basename(p)}:${contentHash}\n`);
  }
  return hash.digest("hex");
}
