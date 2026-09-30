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
 * fal.ai AI Avatar (single-text). One call turns a still image plus a line of
 * text into a talking video: the model synthesises the voice from `text_input`
 * (using a built-in `voice`) AND lip-syncs it - there is no separate audio file.
 * Endpoint id and input/output fields confirmed from fal's official API schema:
 * https://fal.ai/models/fal-ai/ai-avatar/single-text/api
 */
export const AVATAR_SINGLE_TEXT_ENDPOINT_ID = "fal-ai/ai-avatar/single-text";

/** Default frame count from fal's schema (~5.8s at 25fps). Range 41-721. */
const DEFAULT_NUM_FRAMES = 145;

/** The built-in TTS voices this endpoint accepts (from fal's schema). */
export const AVATAR_VOICES = [
  "Aria", "Roger", "Sarah", "Laura", "Charlie", "George", "Callum", "River",
  "Liam", "Charlotte", "Alice", "Matilda", "Will", "Jessica", "Eric", "Chris",
  "Brian", "Daniel", "Lily", "Bill",
] as const;
export type AvatarVoice = (typeof AVATAR_VOICES)[number];

/** The resolutions this endpoint accepts. */
type AvatarResolution = "480p" | "720p";

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

export class FalAvatarSingleTextProvider implements VideoProvider {
  readonly name = "fal:ai-avatar:single-text";
  readonly endpointId = AVATAR_SINGLE_TEXT_ENDPOINT_ID;
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
      throw new Error("AI Avatar needs exactly one reference image (image_url).");
    }
    if (!input.textInput || input.textInput.trim().length === 0) {
      throw new Error("AI Avatar needs a line of text to speak (textInput).");
    }
    if (!input.voice || !AVATAR_VOICES.includes(input.voice as AvatarVoice)) {
      throw new Error(
        `AI Avatar needs a supported voice. Got "${input.voice ?? ""}"; choose one of: ${AVATAR_VOICES.join(", ")}.`,
      );
    }
    if (input.resolution !== "480p" && input.resolution !== "720p") {
      throw new Error(
        `AI Avatar supports only 480p or 720p. Got "${input.resolution}".`,
      );
    }

    try {
      const submitted = await fal.queue.submit(this.endpointId, {
        input: {
          image_url: imageUrl,
          text_input: input.textInput,
          voice: input.voice as AvatarVoice,
          prompt: input.prompt,
          num_frames: input.numFrames ?? DEFAULT_NUM_FRAMES,
          resolution: input.resolution as AvatarResolution,
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
