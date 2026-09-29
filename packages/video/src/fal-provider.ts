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

/**
 * fal.ai Seedance 2.5 reference-to-video.
 * Endpoint id and input/output fields confirmed from fal's official API schema:
 * https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api
 * Uses the standard endpoint (not the /us/ variant), per the roadmap.
 */
export const SEEDANCE_ENDPOINT_ID = "bytedance/seedance-2.5/reference-to-video";

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export class FalSeedanceProvider implements VideoProvider {
  readonly name = "fal:seedance-2.5:reference-to-video";
  readonly endpointId = SEEDANCE_ENDPOINT_ID;
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
    // fal.storage.upload accepts a Blob; File (a Blob subclass) also carries a name.
    const file = new File([buf], basename(localPath), { type });
    return fal.storage.upload(file);
  }

  async submit(input: VideoJobInput): Promise<{ requestId: string }> {
    this.ensureConfigured();
    const submitted = await fal.queue.submit(this.endpointId, {
      input: {
        prompt: input.prompt,
        image_urls: [...input.imageUrls],
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        duration: input.duration,
        generate_audio: input.generateAudio,
      },
    });
    return { requestId: submitted.request_id };
  }

  async status(requestId: string): Promise<VideoStatus> {
    this.ensureConfigured();
    const s = await fal.queue.status(this.endpointId, { requestId });
    return { state: s.status, raw: s };
  }

  async result(requestId: string): Promise<VideoResult> {
    this.ensureConfigured();
    const r = await fal.queue.result(this.endpointId, { requestId });
    const data = r.data as { video?: { url?: string }; seed?: number };
    const url = data?.video?.url;
    if (!url) {
      throw new Error("fal result did not include a video URL.");
    }
    return { videoUrl: url, seed: data.seed };
  }
}
