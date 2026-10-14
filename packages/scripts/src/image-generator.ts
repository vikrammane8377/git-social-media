import OpenAI, { toFile } from "openai";
import { BIX_MASCOT_DESCRIPTION } from "./asset-analyzer.js";
import type { NeededImage } from "./types.js";

/**
 * Synthesises reference stills in Bix's style for images the writer requested
 * (see {@link NeededImage}) when the asset library lacks a good fit. Mirrors the
 * shape of {@link AssetAnalyzer} + the Sol client wrapper: a tiny
 * {@link ImageGenClient} interface keeps the package testable with a fake, while
 * the real OpenAI SDK is wired up only in {@link createOpenAiImageGenerator}.
 *
 * UNVERIFIED: the configured model alias (e.g. "gpt-image-2.5-sunburst") and the
 * `images.edit` reference-image support are not guaranteed. The model is
 * config-swappable and every call site treats failures as non-fatal.
 */

/** Raw image bytes plus their MIME type. */
export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
}

export interface ImageGenRequest {
  /** Image model (config alias passed straight through, UNVERIFIED). */
  model: string;
  /** The full image-gen prompt (already style-anchored). */
  prompt: string;
  /** Requested size, e.g. "1024x1536" (vertical 9:16). */
  size: string;
  /**
   * Optional reference images for subject/style consistency. When present the
   * OpenAI path uses `images.edit`; otherwise `images.generate`.
   */
  referenceImages?: ReadonlyArray<GeneratedImage>;
}

export interface ImageGenClient {
  generate(req: ImageGenRequest): Promise<GeneratedImage>;
}

/** Decode the first `b64_json` image from an OpenAI images response. */
function decodeB64(data: Array<{ b64_json?: string }> | undefined): GeneratedImage {
  const b64 = data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Image model returned no image data (missing b64_json).");
  }
  return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
}

/**
 * Wrap the OpenAI SDK's images API as our {@link ImageGenClient}. With reference
 * images it calls `images.edit` (subject/style consistency for Bix); without, it
 * calls `images.generate`. The model alias is forwarded unchanged.
 */
export function createOpenAiImageGenerator(apiKey: string): ImageGenClient {
  const client = new OpenAI({ apiKey });
  return {
    async generate(req: ImageGenRequest): Promise<GeneratedImage> {
      const size = req.size as OpenAI.Images.ImageGenerateParams["size"];
      if (req.referenceImages && req.referenceImages.length > 0) {
        const images = await Promise.all(
          req.referenceImages.map((r, i) =>
            toFile(r.bytes, `reference-${i}.png`, { type: r.mime || "image/png" }),
          ),
        );
        const res = await client.images.edit({
          model: req.model,
          image: images,
          prompt: req.prompt,
          size: size as OpenAI.Images.ImageEditParams["size"],
        });
        return decodeB64(res.data);
      }
      const res = await client.images.generate({
        model: req.model,
        prompt: req.prompt,
        size,
      });
      return decodeB64(res.data);
    },
  };
}

export interface ImageGeneratorDeps {
  client: ImageGenClient;
  /** Image model alias (from config.image.model). */
  model: string;
  /** Output size, e.g. "1024x1536" (vertical 9:16). */
  size: string;
  /**
   * Brand art direction appended to every prompt (from config.image.artDirection)
   * so generated stills get a clean, consistent, on-brand look. Optional: an empty
   * value simply omits the art-direction line.
   */
  artDirection?: string;
}

/**
 * Builds a style-anchored prompt from a {@link NeededImage} and generates the
 * image through an {@link ImageGenClient}. The prompt forces Bix's established
 * look, vertical 9:16 framing, and no on-screen text; Bix reference bytes are
 * forwarded for subject/style consistency.
 */
export class ImageGenerator {
  private readonly client: ImageGenClient;
  private readonly model: string;
  private readonly size: string;
  private readonly artDirection: string;

  constructor(deps: ImageGeneratorDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.size = deps.size;
    this.artDirection = deps.artDirection?.trim() ?? "";
  }

  /** Generate one still for a requested image, optionally anchored to references. */
  async generate(
    need: NeededImage,
    referenceImages: ReadonlyArray<GeneratedImage> = [],
  ): Promise<GeneratedImage> {
    return this.client.generate({
      model: this.model,
      size: this.size,
      prompt: this.buildPrompt(need),
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    });
  }

  /** Compose the final image-gen prompt: mascot + style anchor + art direction + guardrails. */
  private buildPrompt(need: NeededImage): string {
    const lines = [
      `Generate a single reference still of ${BIX_MASCOT_DESCRIPTION}.`,
      "Match Bix's established look and the style of any provided reference",
      "image(s) for subject and style consistency.",
      `Scene: ${need.prompt}`,
      "Vertical 9:16 composition. Absolutely no on-screen text, captions,",
      "subtitles, signs, watermarks or logos.",
    ];
    if (this.artDirection) lines.push(this.artDirection);
    return lines.join("\n");
  }
}
