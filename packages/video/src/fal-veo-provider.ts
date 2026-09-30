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
 * fal.ai Veo 3.1 Fast image-to-video. One call animates a still image from a
 * text prompt and, with `generate_audio` on, synthesises matching audio -
 * including spoken dialogue and lip-sync - described in the prompt.
 * Endpoint id and input/output fields confirmed from fal's official API schema:
 * https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api
 */
export const VEO31_FAST_ENDPOINT_ID = "fal-ai/veo3.1/fast/image-to-video";

/** The durations this endpoint accepts (from fal's schema). */
export const VEO_DURATIONS = ["4s", "6s", "8s"] as const;
type VeoDuration = (typeof VEO_DURATIONS)[number];

/** The resolutions this endpoint accepts (per the fal client's typed schema). */
export const VEO_RESOLUTIONS = ["720p", "1080p"] as const;
type VeoResolution = (typeof VEO_RESOLUTIONS)[number];

/** The aspect ratios this endpoint accepts. */
export const VEO_ASPECT_RATIOS = ["auto", "16:9", "9:16"] as const;
type VeoAspectRatio = (typeof VEO_ASPECT_RATIOS)[number];

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** Map a neutral duration (number of seconds or "Ns") to Veo's enum. */
function toVeoDuration(duration: number | string): VeoDuration {
  const s = typeof duration === "number" ? `${duration}s` : duration;
  if (!VEO_DURATIONS.includes(s as VeoDuration)) {
    throw new Error(
      `Veo 3.1 supports only these durations: ${VEO_DURATIONS.join(", ")}. Got "${s}".`,
    );
  }
  return s as VeoDuration;
}

export class FalVeo31FastProvider implements VideoProvider {
  readonly name = "fal:veo3.1-fast:image-to-video";
  readonly endpointId = VEO31_FAST_ENDPOINT_ID;
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
      throw new Error("Veo 3.1 needs exactly one reference image (image_url).");
    }
    if (!VEO_RESOLUTIONS.includes(input.resolution as VeoResolution)) {
      throw new Error(
        `Veo 3.1 supports only these resolutions: ${VEO_RESOLUTIONS.join(", ")}. Got "${input.resolution}".`,
      );
    }
    if (!VEO_ASPECT_RATIOS.includes(input.aspectRatio as VeoAspectRatio)) {
      throw new Error(
        `Veo 3.1 supports only these aspect ratios: ${VEO_ASPECT_RATIOS.join(", ")}. Got "${input.aspectRatio}".`,
      );
    }
    const duration = toVeoDuration(input.duration);

    try {
      const submitted = await fal.queue.submit(this.endpointId, {
        input: {
          prompt: input.prompt,
          image_url: imageUrl,
          resolution: input.resolution as VeoResolution,
          aspect_ratio: input.aspectRatio as VeoAspectRatio,
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
