import type { ChannelConfig, CompetitorVideo, ResolvedChannel } from "./types.js";

/** Default base URL for the YouTube Data API v3 (swappable via config). */
export const DEFAULT_YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";

/** The subset of `fetch` we use, so tests can inject a fake. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/** Read-only client over the tracked channels' public data. */
export interface YouTubeClient {
  /** Resolve a channel by @handle or channel id to its identity + uploads playlist. */
  resolveChannel(channel: ChannelConfig): Promise<ResolvedChannel>;
  /**
   * Recent Shorts (duration <= maxShortSeconds) for a resolved channel, newest
   * first, up to `max`. Includes public view/like/comment counts where present.
   */
  recentShorts(
    channel: ResolvedChannel,
    channelName: string,
    weight: number,
    max: number,
    maxShortSeconds: number,
  ): Promise<CompetitorVideo[]>;
}

export interface YouTubeDataClientDeps {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

/**
 * Parse an ISO-8601 duration (e.g. "PT1M30S", "PT45S", "PT1H2M3S") to whole
 * seconds. Returns 0 for anything it cannot parse. Days/weeks are unusual for
 * videos but supported for completeness.
 */
export function parseIsoDuration(value: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return 0;
  const [, w, d, h, min, s] = m;
  return (
    Number(w ?? 0) * 604800 +
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0)
  );
}

/** Parse a public count string (YouTube returns them as strings) to a number. */
function toCount(value: unknown): number | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * YouTube Data API v3 implementation. Uses only key-authenticated read
 * endpoints (no OAuth): channels.list, playlistItems.list, videos.list. Avoids
 * search.list (100 quota units) by reading each channel's uploads playlist
 * (1 unit) and then videos.list (1 unit) in batches of 50.
 *
 * Field shapes follow the documented v3 contract; they are unverified against a
 * live key here (no YOUTUBE_API_KEY yet — build now, run later).
 */
export class YouTubeDataClient implements YouTubeClient {
  private readonly apiKey: string;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;

  constructor(deps: YouTubeDataClientDeps) {
    this.apiKey = deps.apiKey;
    this.fetch = deps.fetch;
    this.baseUrl = (deps.baseUrl ?? DEFAULT_YOUTUBE_BASE_URL).replace(/\/+$/, "");
  }

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ ...params, key: this.apiKey }).toString();
    const url = `${this.baseUrl}/${path}?${query}`;
    const res = await this.fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube API ${path} failed: HTTP ${res.status}${body ? ` — ${body}` : ""}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return json;
  }

  async resolveChannel(channel: ChannelConfig): Promise<ResolvedChannel> {
    const params: Record<string, string> = { part: "snippet,contentDetails,statistics" };
    if (channel.id) {
      params.id = channel.id;
    } else if (channel.handle) {
      // forHandle accepts a handle with or without the leading '@'.
      params.forHandle = channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`;
    } else {
      throw new Error(`Channel "${channel.name}" has neither an id nor a handle.`);
    }

    const json = await this.get("channels", params);
    const items = Array.isArray(json.items) ? json.items : [];
    if (items.length === 0) {
      throw new Error(`No channel found for ${channel.id ?? channel.handle}.`);
    }

    const item = items[0] as Record<string, unknown>;
    const snippet = (item.snippet ?? {}) as Record<string, unknown>;
    const contentDetails = (item.contentDetails ?? {}) as Record<string, unknown>;
    const related = (contentDetails.relatedPlaylists ?? {}) as Record<string, unknown>;
    const statistics = (item.statistics ?? {}) as Record<string, unknown>;

    const uploads = typeof related.uploads === "string" ? related.uploads : "";
    if (!uploads) {
      throw new Error(`Channel ${channel.name} has no uploads playlist in the API response.`);
    }

    return {
      channelId: typeof item.id === "string" ? item.id : "",
      title: typeof snippet.title === "string" ? snippet.title : channel.name,
      uploadsPlaylistId: uploads,
      subscriberCount: toCount(statistics.subscriberCount),
      videoCount: toCount(statistics.videoCount),
    };
  }

  async recentShorts(
    channel: ResolvedChannel,
    channelName: string,
    weight: number,
    max: number,
    maxShortSeconds: number,
  ): Promise<CompetitorVideo[]> {
    const videoIds = await this.recentUploadIds(channel.uploadsPlaylistId, max);
    if (videoIds.length === 0) return [];

    const videos = await this.videosById(videoIds, channel.channelId, channelName, weight);
    // Keep only Shorts-length clips, preserving newest-first order.
    return videos.filter((v) => v.durationSeconds > 0 && v.durationSeconds <= maxShortSeconds);
  }

  /** Newest upload video ids from the uploads playlist, paging until `max`. */
  private async recentUploadIds(uploadsPlaylistId: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;

    while (ids.length < max) {
      const params: Record<string, string> = {
        part: "contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(Math.min(50, max - ids.length)),
      };
      if (pageToken) params.pageToken = pageToken;

      const json = await this.get("playlistItems", params);
      const items = Array.isArray(json.items) ? json.items : [];
      for (const raw of items) {
        const item = raw as Record<string, unknown>;
        const cd = (item.contentDetails ?? {}) as Record<string, unknown>;
        if (typeof cd.videoId === "string" && cd.videoId) ids.push(cd.videoId);
      }

      pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : undefined;
      if (!pageToken || items.length === 0) break;
    }

    return ids.slice(0, max);
  }

  /** Fetch full video metadata for ids, in batches of 50 (API limit). */
  private async videosById(
    videoIds: string[],
    channelId: string,
    channelName: string,
    weight: number,
  ): Promise<CompetitorVideo[]> {
    const out: CompetitorVideo[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const json = await this.get("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
      });
      const items = Array.isArray(json.items) ? json.items : [];
      for (const raw of items) {
        const item = raw as Record<string, unknown>;
        const snippet = (item.snippet ?? {}) as Record<string, unknown>;
        const contentDetails = (item.contentDetails ?? {}) as Record<string, unknown>;
        const statistics = (item.statistics ?? {}) as Record<string, unknown>;

        out.push({
          videoId: typeof item.id === "string" ? item.id : "",
          channelId,
          channelName:
            typeof snippet.channelTitle === "string" ? snippet.channelTitle : channelName,
          title: typeof snippet.title === "string" ? snippet.title : "",
          publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : "",
          durationSeconds:
            typeof contentDetails.duration === "string"
              ? parseIsoDuration(contentDetails.duration)
              : 0,
          viewCount: toCount(statistics.viewCount),
          likeCount: toCount(statistics.likeCount),
          commentCount: toCount(statistics.commentCount),
          weight,
        });
      }
    }
    return out;
  }
}
