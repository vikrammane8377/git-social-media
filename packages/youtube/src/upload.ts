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

const THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

const CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true";

const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";

/** A custom thumbnail image to set on the uploaded video. */
export interface ThumbnailImage {
  readonly bytes: Buffer;
  /** Image MIME type, e.g. "image/png" or "image/jpeg". */
  readonly mime: string;
}

export interface UploadRequest {
  readonly fileBytes: Buffer;
  readonly metadata: VideoMetadata;
  /** Optional privacy override; defaults to the metadata's privacyStatus. */
  readonly privacy?: string;
  /**
   * Optional custom thumbnail, set after the video upload succeeds. Setting a
   * custom thumbnail needs channel eligibility, so a failure here is NON-FATAL:
   * it is logged and the successful video upload is still returned.
   */
  readonly thumbnail?: ThumbnailImage;
}

export interface UploadResult {
  readonly videoId: string;
  readonly url: string;
}

/** One of the channel's uploaded videos, as returned by `listRecentUploads`. */
export interface ChannelUpload {
  readonly videoId: string;
  readonly title: string;
  /** ISO 8601 publish time, newest-first in the list. */
  readonly publishedAt: string;
  readonly privacy: string;
}

export interface UploaderDeps {
  /** Obtain a bearer access token. Defaults to the OAuth store. */
  readonly getAccessToken?: () => Promise<string>;
  /** Injectable fetch for tests. Defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Warning sink for non-fatal issues (e.g. thumbnail). Defaults to console.warn. */
  readonly logger?: (message: string) => void;
}

export class YouTubeUploader {
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;

  constructor(deps: UploaderDeps = {}) {
    this.getToken = deps.getAccessToken ?? getAccessToken;
    this.fetchImpl = deps.fetch ?? fetch;
    this.log = deps.logger ?? ((m) => console.warn(m));
  }

  async upload(request: UploadRequest): Promise<UploadResult> {
    const accessToken = await this.getToken();
    const sessionUri = await this.initiate(request, accessToken);
    const result = await this.putBytes(sessionUri, request.fileBytes);
    if (request.thumbnail) {
      await this.setThumbnail(result.videoId, request.thumbnail, accessToken);
    }
    return result;
  }

  /**
   * Flip an already-uploaded video's privacy via `videos.update`. We first GET
   * the current `status` part and merge the new `privacyStatus` into it so that
   * other mutable status fields (selfDeclaredMadeForKids, license, embeddable,
   * publicStatsViewable) are preserved rather than reset. Requires the broader
   * `youtube` (manage) OAuth scope — re-login if the token predates it.
   */
  async updatePrivacy(videoId: string, privacyStatus: string): Promise<void> {
    const accessToken = await this.getToken();

    const getRes = await this.fetchImpl(
      `${VIDEOS_URL}?part=status&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!getRes.ok) {
      throw new Error(await this.errorMessage(getRes, "read video status"));
    }
    const data = (await getRes.json()) as {
      items?: { status?: Record<string, unknown> }[];
    };
    const current = data.items?.[0]?.status;
    if (!current) {
      throw new Error(`YouTube returned no video with id ${videoId}.`);
    }

    const status: Record<string, unknown> = {
      privacyStatus,
      selfDeclaredMadeForKids: current.selfDeclaredMadeForKids ?? false,
    };
    if (current.license !== undefined) status.license = current.license;
    if (current.embeddable !== undefined) status.embeddable = current.embeddable;
    if (current.publicStatsViewable !== undefined) {
      status.publicStatsViewable = current.publicStatsViewable;
    }

    const putRes = await this.fetchImpl(`${VIDEOS_URL}?part=status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: videoId, status }),
    });
    if (!putRes.ok) {
      throw new Error(await this.errorMessage(putRes, "update video privacy"));
    }
  }

  /**
   * List the authenticated channel's most recent uploads, newest first. Used to
   * reconcile an interrupted upload: if the process died after YouTube accepted
   * a video but before we recorded its id, the video is here and can be adopted
   * instead of re-uploaded (which would duplicate it). Requires a read scope
   * (youtube.readonly or the broader youtube); a youtube.upload-only token gets
   * a 403 that is surfaced to the caller so it can decide how to degrade.
   */
  async listRecentUploads(max = 25): Promise<ChannelUpload[]> {
    const accessToken = await this.getToken();
    const auth = { Authorization: `Bearer ${accessToken}` };

    const chRes = await this.fetchImpl(CHANNELS_URL, { headers: auth });
    if (!chRes.ok) {
      throw new Error(await this.errorMessage(chRes, "read channel"));
    }
    const chData = (await chRes.json()) as {
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    };
    const playlistId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId) return [];

    const url =
      `${PLAYLIST_ITEMS_URL}?part=snippet,status&maxResults=${max}` +
      `&playlistId=${encodeURIComponent(playlistId)}`;
    const plRes = await this.fetchImpl(url, { headers: auth });
    if (!plRes.ok) {
      throw new Error(await this.errorMessage(plRes, "list uploads"));
    }
    const plData = (await plRes.json()) as {
      items?: {
        snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } };
        status?: { privacyStatus?: string };
      }[];
    };

    const uploads: ChannelUpload[] = [];
    for (const item of plData.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      uploads.push({
        videoId,
        title: item.snippet?.title ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        privacy: item.status?.privacyStatus ?? "",
      });
    }
    return uploads;
  }

  /**
   * Set a custom thumbnail on the uploaded video. NON-FATAL: custom thumbnails
   * require channel eligibility, so any failure is logged and swallowed — a
   * thumbnail must never fail an already-successful video upload.
   */
  private async setThumbnail(
    videoId: string,
    thumbnail: ThumbnailImage,
    accessToken: string,
  ): Promise<void> {
    try {
      const url = `${THUMBNAIL_URL}?videoId=${encodeURIComponent(videoId)}`;
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": thumbnail.mime,
        },
        body: thumbnail.bytes,
      });
      if (!res.ok) {
        this.log(
          `Thumbnail not set (${await this.errorMessage(res, "set thumbnail")}); video published without a custom thumbnail.`,
        );
      }
    } catch (err) {
      this.log(
        `Thumbnail not set (${err instanceof Error ? err.message : String(err)}); video published without a custom thumbnail.`,
      );
    }
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
