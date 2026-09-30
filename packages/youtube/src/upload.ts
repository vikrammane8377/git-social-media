import { getAccessToken } from "./oauth.js";
import type { VideoMetadata } from "./metadata.js";

/**
 * Uploads an MP4 to YouTube via the Data API v3 resumable, two-phase protocol:
 *   1. POST to initiate the session (JSON snippet+status) -> the response's
 *      `Location` header is the session URI.
 *   2. PUT the full MP4 bytes to that session URI -> 201 Created with the video
 *      resource; its `id` yields the watch URL.
 * A single PUT of the whole file is fine at our sizes (33-86 MB). Google's own
 * error body is surfaced on any non-2xx response (never a fake success).
 */

const INITIATE_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export interface UploadRequest {
  readonly fileBytes: Buffer;
  readonly metadata: VideoMetadata;
  /** Optional privacy override; defaults to the metadata's privacyStatus. */
  readonly privacy?: string;
}

export interface UploadResult {
  readonly videoId: string;
  readonly url: string;
}

export interface UploaderDeps {
  /** Obtain a bearer access token. Defaults to the OAuth store. */
  readonly getAccessToken?: () => Promise<string>;
  /** Injectable fetch for tests. Defaults to global fetch. */
  readonly fetch?: typeof fetch;
}

export class YouTubeUploader {
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: UploaderDeps = {}) {
    this.getToken = deps.getAccessToken ?? getAccessToken;
    this.fetchImpl = deps.fetch ?? fetch;
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    const accessToken = await this.getToken();
    const sessionUri = await this.initiate(request, accessToken);
    return this.putBytes(sessionUri, request.fileBytes);
  }

  /** Phase 1: open a resumable session; return the session URI. */
  private async initiate(request: UploadRequest, accessToken: string): Promise<string> {
    const { metadata, fileBytes } = request;
    const body = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
      },
      status: {
        privacyStatus: request.privacy ?? metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: metadata.containsSyntheticMedia,
      },
    };

    const res = await this.fetchImpl(INITIATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(fileBytes.length),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(await this.errorMessage(res, "initiate upload"));
    }
    const sessionUri = res.headers.get("location");
    if (!sessionUri) {
      throw new Error("YouTube did not return a resumable session URI (no Location header).");
    }
    return sessionUri;
  }

  /** Phase 2: upload the full MP4 bytes; return the created video id and URL. */
  private async putBytes(sessionUri: string, fileBytes: Buffer): Promise<UploadResult> {
    const res = await this.fetchImpl(sessionUri, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: fileBytes,
    });

    if (!res.ok) {
      throw new Error(await this.errorMessage(res, "upload video bytes"));
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      throw new Error("YouTube upload completed but returned no video id.");
    }
    return { videoId: data.id, url: `https://youtu.be/${data.id}` };
  }

  /** Build an error message that includes Google's own response body. */
  private async errorMessage(res: Response, action: string): Promise<string> {
    let detail = res.statusText;
    try {
      const text = await res.text();
      if (text) detail = text;
    } catch {
      // Keep statusText if the body cannot be read.
    }
    return `YouTube failed to ${action} (${res.status}): ${detail}`;
  }
}
