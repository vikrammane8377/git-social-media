/**
 * Adds burned-in captions to a local MP4 using the OpusClip API. The flow keeps
 * the source private (no public URL needed) by uploading the bytes directly to
 * OpusClip's storage, then asking it to caption the whole clip:
 *   1. POST /api/upload-links            -> { url, uploadId }
 *   2. POST <url> (x-goog-resumable)     -> Location: a resumable session URI
 *   3. PUT  <session> (octet-stream)     -> the MP4 bytes land in OpusClip storage
 *   4. POST /api/clip-projects           -> { id } (videoUrl = uploadId)
 *   5. GET  /api/exportable-clips        -> poll until a clip has `uriForExport`
 *   6. GET  <uriForExport>               -> download the captioned MP4 bytes
 * Whole-video captioning uses curationPref.skipCurate/skipSlicing so OpusClip
 * returns one clip spanning the entire source rather than auto-cut highlights.
 */

const API_BASE = "https://api.opus.pro/api";
const UPLOAD_LINKS_URL = `${API_BASE}/upload-links`;
const CLIP_PROJECTS_URL = `${API_BASE}/clip-projects`;
const EXPORTABLE_CLIPS_URL = `${API_BASE}/exportable-clips`;

export type CaptionLayout = "portrait" | "landscape" | "square";

/** Map a "W:H" aspect ratio to OpusClip's render layout (default portrait). */
export function aspectRatioToLayout(aspectRatio: string): CaptionLayout {
  const [w, h] = aspectRatio.split(":").map((n) => Number(n));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    if (w === h) return "square";
    return w > h ? "landscape" : "portrait";
  }
  return "portrait";
}

/** One clip returned by the exportable-clips listing. */
export interface ExportableClip {
  readonly id: string;
  readonly title: string;
  readonly durationMs: number;
  /** Signed MP4 download URL (empty/absent until the render is ready). */
  readonly uriForExport: string;
}

/**
 * Choose the finished clip to download: the first one carrying a non-empty
 * `uriForExport`. Pure so the polling decision is unit-testable. Returns null
 * when nothing is ready yet.
 */
export function pickExportableClip(clips: readonly ExportableClip[]): ExportableClip | null {
  for (const clip of clips) {
    if (clip.uriForExport && clip.uriForExport.length > 0) return clip;
  }
  return null;
}

export interface CaptionOptions {
  /** Render layout; derive from the video aspect ratio (9:16 -> portrait). */
  readonly layoutAspectRatio: CaptionLayout;
  /** Spoken-language hint for transcription; "auto" lets OpusClip detect it. */
  readonly sourceLang?: string;
  /** Title recorded on the OpusClip project (cosmetic). */
  readonly title?: string;
  /** Optional caption-style preset id; omitted = OpusClip's default captions. */
  readonly brandTemplateId?: string;
  /** Poll interval while waiting for the render (ms). Default 15s. */
  readonly pollIntervalMs?: number;
  /** Max poll attempts before giving up. Default 80 (~20 min at 15s). */
  readonly maxPolls?: number;
}

export interface CaptionerDeps {
  /** OpusClip API key (read by the caller from the CAPTIONS env var). */
  readonly apiKey: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Injectable delay for tests. Defaults to real setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Progress sink. Defaults to console.log. */
  readonly logger?: (message: string) => void;
}

export class OpusClipCaptioner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(deps: CaptionerDeps) {
    if (!deps.apiKey) throw new Error("OpusClipCaptioner needs an API key.");
    this.apiKey = deps.apiKey;
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = deps.logger ?? ((m) => console.log(m));
  }

  /** Caption the whole clip and return the rendered MP4 bytes. */
  async caption(fileBytes: Buffer, opts: CaptionOptions): Promise<Buffer> {
    const uploadId = await this.uploadSource(fileBytes);
    const projectId = await this.createProject(uploadId, opts);
    this.log(`OpusClip project ${projectId} queued; waiting for the captioned render...`);
    const clip = await this.awaitClip(projectId, opts);
    this.log(`Captioned render ready (${Math.round(clip.durationMs / 1000)}s); downloading...`);
    return await this.download(clip.uriForExport);
  }

  /** Steps 1-3: push the local bytes into OpusClip storage; return the uploadId. */
  private async uploadSource(fileBytes: Buffer): Promise<string> {
    const linkRes = await this.fetchImpl(UPLOAD_LINKS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ video: { usecase: "LocalUpload" } }),
    });
    if (!linkRes.ok) throw new Error(await this.errorMessage(linkRes, "request an upload link"));
    const link = (await linkRes.json()) as { url?: string; uploadId?: string };
    if (!link.url || !link.uploadId) {
      throw new Error("OpusClip upload-links response was missing url/uploadId.");
    }

    // Open a GCS resumable session; its Location header is where the bytes go.
    const initRes = await this.fetchImpl(link.url, {
      method: "POST",
      headers: { "x-goog-resumable": "start", "Content-Length": "0" },
    });
    if (!initRes.ok) throw new Error(await this.errorMessage(initRes, "start the upload session"));
    const session = initRes.headers.get("location");
    if (!session) {
      throw new Error("OpusClip did not return a resumable upload session (no Location header).");
    }

    const putRes = await this.fetchImpl(session, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: fileBytes,
    });
    if (!putRes.ok) throw new Error(await this.errorMessage(putRes, "upload the video bytes"));

    return link.uploadId;
  }

  /** Step 4: create a whole-video clip project; return its id. */
  private async createProject(uploadId: string, opts: CaptionOptions): Promise<string> {
    const body: Record<string, unknown> = {
      videoUrl: uploadId,
      uploadedVideoAttr: { title: opts.title ?? "Bix captioned clip" },
      // Whole video, no highlight auto-cutting: one clip spanning the source.
      curationPref: { skipCurate: true, skipSlicing: true },
      renderPref: { layoutAspectRatio: opts.layoutAspectRatio, enableCaption: true },
      importPref: { sourceLang: opts.sourceLang ?? "auto" },
    };
    if (opts.brandTemplateId) body.brandTemplateId = opts.brandTemplateId;

    const res = await this.fetchImpl(CLIP_PROJECTS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await this.errorMessage(res, "create the clip project"));
    const data = (await res.json()) as { id?: string; projectId?: string };
    const projectId = data.id ?? data.projectId;
    if (!projectId) throw new Error("OpusClip created a project but returned no id.");
    return projectId;
  }

  /** Step 5: poll until a clip carries a downloadable `uriForExport`. */
  private async awaitClip(projectId: string, opts: CaptionOptions): Promise<ExportableClip> {
    const interval = opts.pollIntervalMs ?? 15000;
    const maxPolls = opts.maxPolls ?? 80;
    const url =
      `${EXPORTABLE_CLIPS_URL}?q=findByProjectId&projectId=${encodeURIComponent(projectId)}`;

    for (let attempt = 0; attempt < maxPolls; attempt++) {
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) throw new Error(await this.errorMessage(res, "list exportable clips"));
      const data = (await res.json()) as { data?: ExportableClip[] };
      const clip = pickExportableClip(data.data ?? []);
      if (clip) return clip;
      await this.sleep(interval);
    }
    throw new Error(
      `OpusClip did not finish captioning project ${projectId} within ${maxPolls} polls.`,
    );
  }

  /** Step 6: download the finished MP4 from its signed URL. */
  private async download(uri: string): Promise<Buffer> {
    const res = await this.fetchImpl(uri);
    if (!res.ok) throw new Error(await this.errorMessage(res, "download the captioned video"));
    return Buffer.from(await res.arrayBuffer());
  }

  /** Build an error message that includes OpusClip's own response body. */
  private async errorMessage(res: Response, action: string): Promise<string> {
    let detail = res.statusText;
    try {
      const text = await res.text();
      if (text) detail = text;
    } catch {
      // Keep statusText if the body cannot be read.
    }
    return `OpusClip failed to ${action} (${res.status}): ${detail}`;
  }
}
