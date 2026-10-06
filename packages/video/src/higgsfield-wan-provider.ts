import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { callTool } from "@bix/higgsfield";
import type {
  VideoJobInput,
  VideoProvider,
  VideoResult,
  VideoStatus,
  VideoStatusState,
} from "./types.js";

/**
 * Higgsfield Wan 3.0 (image + reference-to-video with native audio), driven
 * through Higgsfield's hosted MCP server rather than a fal endpoint. Unlike the
 * fal providers this one spends the user's Higgsfield subscription credits (via
 * the OAuth login), not a fal API key.
 *
 * The reference image becomes the first frame (`start_image` role). Dialogue is
 * spoken from the prompt; `generate_audio` yields the native audio track. Model
 * id and parameters confirmed live from `models_explore(get, "wan3_0")`:
 * duration 2-30s, resolution 480p/720p/1080p, aspect 16:9/9:16/1:1/4:3/3:4.
 */
export const WAN3_MODEL_ID = "wan3_0";

/** The durations Wan 3.0 accepts, in whole seconds (from its model contract). */
export const WAN3_MIN_DURATION = 2;
export const WAN3_MAX_DURATION = 30;

/**
 * Role for the 2nd..Nth reference images when more than one is supplied. The
 * first image is always the `start_image` (first frame); additional images are
 * passed as extra references. UNVERIFIED: the exact role name Wan 3.0 expects
 * for supplementary references has not been confirmed live against Higgsfield —
 * verify with `models_explore(get, "wan3_0")` before relying on multi-image in
 * production. The single-image path is unaffected by this constant.
 */
export const WAN_REFERENCE_ROLE = "reference_image";

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

/** The envelope every MCP tool call returns. */
interface McpToolResult {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

/** Throw with the server's own message when a tool call reports an error. */
function ensureOk(res: McpToolResult, action: string): void {
  if (!res.isError) return;
  const structured = res.structuredContent as { error?: string } | undefined;
  const text = res.content?.find((c) => c.type === "text")?.text;
  throw new Error(`Higgsfield ${action} failed: ${structured?.error ?? text ?? "unknown error"}`);
}

/** Map a neutral duration (seconds or "N") to a whole-second Wan duration. */
function toWanDuration(duration: number | string): number {
  const n = typeof duration === "number" ? duration : Number(duration);
  if (!Number.isInteger(n) || n < WAN3_MIN_DURATION || n > WAN3_MAX_DURATION) {
    throw new Error(
      `Wan 3.0 supports durations ${WAN3_MIN_DURATION}-${WAN3_MAX_DURATION}s (whole seconds). Got "${duration}".`,
    );
  }
  return n;
}

/**
 * If a generate_video reply is a preset recommendation (no job created), return
 * the recommended preset's id so the caller can decline it and retry literally.
 */
function findRecommendedPresetId(res: McpToolResult): string | undefined {
  const notice = (res.structuredContent as {
    notice?: { type?: string; data?: { preset?: { id?: string } } };
  })?.notice;
  if (notice?.type !== "preset_recommendation") return undefined;
  return notice.data?.preset?.id;
}

/** Normalise Higgsfield job statuses to the runner's three states. */
function toStatusState(status: string): VideoStatusState {
  switch (status) {
    case "queued":
    case "pending":
      return "IN_QUEUE";
    case "in_progress":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    default:
      // failed, ip_detected, or anything unexpected is fatal for a poll loop.
      throw new Error(`Higgsfield job ended in non-recoverable state: ${status}`);
  }
}

export class HiggsfieldWanProvider implements VideoProvider {
  readonly name = "higgsfield:wan3_0";
  readonly endpointId = `higgsfield-mcp/${WAN3_MODEL_ID}`;

  /**
   * Upload one reference image to Higgsfield storage and return its media id.
   * The runner stores this in {@link VideoJobInput.imageUrls}; Wan's `medias`
   * array takes the media id (a UUID), not an https URL.
   */
  async uploadReferenceImage(localPath: string): Promise<string> {
    const filename = basename(localPath);
    const contentType = MIME_BY_EXT[extname(localPath).toLowerCase()] ?? "application/octet-stream";

    const upload = (await callTool("media_upload", { filename, content_type: contentType })) as McpToolResult;
    ensureOk(upload, "media_upload");
    const uploads = (upload.structuredContent as { uploads?: Array<{ upload_url: string; media_id: string }> })?.uploads;
    const first = uploads?.[0];
    if (!first?.upload_url || !first?.media_id) {
      throw new Error("Higgsfield media_upload returned no upload URL or media id.");
    }

    const bytes = await readFile(localPath);
    const put = await fetch(first.upload_url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: bytes,
    });
    if (!put.ok) {
      throw new Error(`Uploading image bytes failed (${put.status} ${put.statusText}).`);
    }

    const confirm = (await callTool("media_confirm", { type: "image", media_id: first.media_id })) as McpToolResult;
    ensureOk(confirm, "media_confirm");
    return first.media_id;
  }

  async submit(input: VideoJobInput): Promise<{ requestId: string }> {
    const mediaId = input.imageUrls[0];
    if (!mediaId) {
      throw new Error("Wan 3.0 needs at least one reference image (start_image).");
    }
    const duration = toWanDuration(input.duration);

    // First image is the first frame (start_image); any others are extra
    // references. A single image yields exactly the previous payload.
    const medias = input.imageUrls.map((value, i) => ({
      value,
      role: i === 0 ? "start_image" : WAN_REFERENCE_ROLE,
    }));

    const params: Record<string, unknown> = {
      model: WAN3_MODEL_ID,
      prompt: input.prompt,
      duration,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      generate_audio: input.generateAudio,
      use_unlim: false,
      medias,
    };

    // The server sometimes intercepts a prompt that resembles a built-in preset
    // and returns a `preset_recommendation` notice *instead of* submitting a job.
    // Our pipeline always wants the literal prompt, so decline the preset and
    // retry once with its id in `declined_preset_id`.
    let res = (await callTool("generate_video", { params })) as McpToolResult;
    ensureOk(res, "generate_video");
    const presetId = findRecommendedPresetId(res);
    if (presetId) {
      params.declined_preset_id = presetId;
      res = (await callTool("generate_video", { params })) as McpToolResult;
      ensureOk(res, "generate_video");
    }

    const results = (res.structuredContent as { results?: Array<{ id?: string }> })?.results;
    const jobId = results?.[0]?.id;
    if (!jobId) {
      throw new Error("Higgsfield generate_video returned no job id.");
    }
    return { requestId: jobId };
  }

  async status(requestId: string): Promise<VideoStatus> {
    const gen = await this.readGeneration(requestId);
    return { state: toStatusState(gen.status), raw: gen };
  }

  async result(requestId: string): Promise<VideoResult> {
    const gen = await this.readGeneration(requestId);
    const url = gen.results?.rawUrl;
    if (!url) {
      throw new Error("Higgsfield job completed but returned no video URL.");
    }
    return { videoUrl: url, seed: gen.params?.seed };
  }

  /** One `job_status` read (non-blocking; the runner owns the poll cadence). */
  private async readGeneration(requestId: string): Promise<{
    status: string;
    results?: { rawUrl?: string };
    params?: { seed?: number };
  }> {
    const res = (await callTool("job_status", { jobId: requestId, sync: false })) as McpToolResult;
    ensureOk(res, "job_status");
    const gen = (res.structuredContent as {
      generation?: { status: string; results?: { rawUrl?: string }; params?: { seed?: number } };
    })?.generation;
    if (!gen?.status) {
      throw new Error("Higgsfield job_status returned no generation status.");
    }
    return gen;
  }
}
