import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fal } from "@fal-ai/client";
import { requireKey } from "@bix/config";
import type {
  VideoJobInput,
  VideoProvider,
  VideoResult,
  VideoStatus,
} from "./types.js";
import { falErrorMessage } from "./fal-error.js";

/**
 * fal.ai Kling V3 Pro image-to-video. One call animates a still image from a
 * text prompt and, with `generate_audio` on, generates native audio - including
 * spoken dialogue (Chinese/English) and lip-sync - described in the prompt.
 * Endpoint id and input/output fields confirmed from fal's official API schema:
 * https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api
 *
 * Note: this endpoint has no resolution or aspect-ratio field - output is 1080p
 * and the aspect ratio is taken from the input image. Those neutral inputs are
 * therefore ignored here.
 */
export const KLING_V3_PRO_ENDPOINT_ID = "fal-ai/kling-video/v3/pro/image-to-video";

/** The durations this endpoint accepts, in seconds (from fal's schema). */
export const KLING_MIN_DURATION = 3;
export const KLING_MAX_DURATION = 15;

/** Kling's `duration` field is a string enum "3".."15". */
type KlingDuration =
  | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "11" | "12" | "13" | "14" | "15";

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** Map a neutral duration (number of seconds or "N") to Kling's string enum. */
function toKlingDuration(duration: number | string): KlingDuration {
  const n = typeof duration === "number" ? duration : Number(duration);
  if (!Number.isInteger(n) || n < KLING_MIN_DURATION || n > KLING_MAX_DURATION) {
    throw new Error(
      `Kling V3 Pro supports durations ${KLING_MIN_DURATION}-${KLING_MAX_DURATION}s (whole seconds). Got "${duration}".`,
    );
  }
  return String(n) as KlingDuration;
}

export class FalKlingV3ProProvider implements VideoProvider {
  readonly name = "fal:kling-v3-pro:image-to-video";
  readonly endpointId = KLING_V3_PRO_ENDPOINT_ID;
  private configured = false;

  /** Configure the client with FAL_KEY exactly once. The value is never logged. */
  private ensureConfigured(): void {
    if (this.configured) return;
    fal.config({ credentials: requireKey("FAL_KEY") });
    this.configured = true;
  }

  async uploadReferenceImage(localPath: string): Promise<string> {
    this.ensureConfigured();
    const buf = await readFile(localPath);
    const type = MIME_BY_EXT[extname(localPath).toLowerCase()] ?? "application/octet-stream";
    const file = new File([buf], basename(localPath), { type });
    return fal.storage.upload(file);
  }

  async submit(input: VideoJobInput): Promise<{ requestId: string }> {
    this.ensureConfigured();

    const imageUrl = input.imageUrls[0];
    if (!imageUrl) {
      throw new Error("Kling V3 Pro needs exactly one reference image (start_image_url).");
    }
    const duration = toKlingDuration(input.duration);

    try {
      const submitted = await fal.queue.submit(this.endpointId, {
        input: {
          start_image_url: imageUrl,
          prompt: input.prompt,
          duration,
          generate_audio: input.generateAudio,
        },
      });
      return { requestId: submitted.request_id };
    } catch (err) {
      throw new Error(falErrorMessage(err));
    }
  }

  async status(requestId: string): Promise<VideoStatus> {
    this.ensureConfigured();
    const s = await fal.queue.status(this.endpointId, { requestId });
    return { state: s.status, raw: s };
  }

  async result(requestId: string): Promise<VideoResult> {
    this.ensureConfigured();
    let data: { video?: { url?: string }; seed?: number };
    try {
      const r = await fal.queue.result(this.endpointId, { requestId });
      data = r.data as { video?: { url?: string }; seed?: number };
    } catch (err) {
      throw new Error(falErrorMessage(err));
    }
    const url = data?.video?.url;
    if (!url) {
      throw new Error("fal result did not include a video URL.");
    }
    return { videoUrl: url, seed: data.seed };
  }
}
