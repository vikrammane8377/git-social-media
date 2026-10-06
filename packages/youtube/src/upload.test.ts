import { describe, it, expect } from "vitest";
import { YouTubeUploader } from "./upload.js";
import type { VideoMetadata } from "./metadata.js";

const metadata: VideoMetadata = {
  title: "Test title",
  description: "Test description",
  tags: ["a", "b"],
  categoryId: "27",
  privacyStatus: "unlisted",
  containsSyntheticMedia: true,
};

const SESSION_URI = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=xyz";

describe("YouTubeUploader", () => {
  it("initiates, follows the Location header, PUTs bytes, and returns the video id/url", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        // Phase 1: initiate -> Location header with the session URI.
        return new Response(null, { status: 200, headers: { location: SESSION_URI } });
      }
      // Phase 2: PUT bytes -> 201 Created with the video resource.
      return new Response(JSON.stringify({ id: "VID123" }), { status: 201 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({
      getAccessToken: async () => "test-token",
      fetch: fetchImpl,
    });

    const result = await uploader.upload({ fileBytes: Buffer.from("MP4DATA"), metadata });

    expect(result).toEqual({ videoId: "VID123", url: "https://youtu.be/VID123" });
    expect(calls).toHaveLength(2);

    // Phase 1 request shape.
    const initiate = calls[0];
    expect(initiate.url).toContain("uploadType=resumable");
    const initHeaders = initiate.init?.headers as Record<string, string>;
    expect(initHeaders.Authorization).toBe("Bearer test-token");
    expect(initHeaders["X-Upload-Content-Type"]).toBe("video/mp4");
    expect(initHeaders["X-Upload-Content-Length"]).toBe(String(Buffer.from("MP4DATA").length));
    const sentBody = JSON.parse(initiate.init?.body as string);
    expect(sentBody.status.privacyStatus).toBe("unlisted");
    expect(sentBody.status.containsSyntheticMedia).toBe(true);
    expect(sentBody.status.selfDeclaredMadeForKids).toBe(false);

    // Phase 2 goes to the session URI as a PUT.
    expect(calls[1].url).toBe(SESSION_URI);
    expect(calls[1].init?.method).toBe("PUT");
  });

  it("honours a privacy override on the request", async () => {
    let sentPrivacy = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") {
        sentPrivacy = JSON.parse(init?.body as string).status.privacyStatus;
        return new Response(null, { status: 200, headers: { location: SESSION_URI } });
      }
      return new Response(JSON.stringify({ id: "VID999" }), { status: 201 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await uploader.upload({ fileBytes: Buffer.from("x"), metadata, privacy: "private" });
    expect(sentPrivacy).toBe("private");
  });

  it("surfaces Google's error body when initiation fails (no fake success)", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":{"message":"quota exceeded"}}', { status: 403 })) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(
      uploader.upload({ fileBytes: Buffer.from("x"), metadata }),
    ).rejects.toThrow(/403.*quota exceeded/);
  });

  it("throws when the initiate response lacks a Location header", async () => {
    const fetchImpl = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(
      uploader.upload({ fileBytes: Buffer.from("x"), metadata }),
    ).rejects.toThrow(/session URI/);
  });

  it("surfaces an error when the PUT fails", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") {
        return new Response(null, { status: 200, headers: { location: SESSION_URI } });
      }
      return new Response("upload broke", { status: 500 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(
      uploader.upload({ fileBytes: Buffer.from("x"), metadata }),
    ).rejects.toThrow(/500.*upload broke/);
  });

  it("sets a custom thumbnail after the video upload when one is provided", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response(null, { status: 200, headers: { location: SESSION_URI } });
      }
      if (calls.length === 2) {
        return new Response(JSON.stringify({ id: "VID123" }), { status: 201 });
      }
      // Phase 3: thumbnail set.
      return new Response(JSON.stringify({ kind: "youtube#thumbnailSetResponse" }), { status: 200 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "tok", fetch: fetchImpl });
    const result = await uploader.upload({
      fileBytes: Buffer.from("MP4DATA"),
      metadata,
      thumbnail: { bytes: Buffer.from("PNGBYTES"), mime: "image/png" },
    });

    expect(result).toEqual({ videoId: "VID123", url: "https://youtu.be/VID123" });
    expect(calls).toHaveLength(3);
    const thumb = calls[2];
    expect(thumb.url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=VID123",
    );
    expect(thumb.init?.method).toBe("POST");
    const headers = thumb.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("image/png");
    expect(thumb.init?.body).toEqual(Buffer.from("PNGBYTES"));
  });

  it("updatePrivacy GETs the current status, merges privacy, and PUTs it back", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (!init || init.method === undefined || init.method === "GET") {
        // GET part=status returns the existing, richer status resource.
        return new Response(
          JSON.stringify({
            items: [
              {
                status: {
                  privacyStatus: "unlisted",
                  selfDeclaredMadeForKids: false,
                  license: "youtube",
                  embeddable: true,
                  publicStatsViewable: true,
                  uploadStatus: "processed",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: "VID123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "tok", fetch: fetchImpl });
    await uploader.updatePrivacy("VID123", "public");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/youtube/v3/videos?part=status&id=VID123",
    );
    const put = calls[1];
    expect(put.url).toBe("https://www.googleapis.com/youtube/v3/videos?part=status");
    expect(put.init?.method).toBe("PUT");
    const headers = put.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    const body = JSON.parse(put.init?.body as string);
    expect(body.id).toBe("VID123");
    expect(body.status.privacyStatus).toBe("public");
    // Preserved mutable fields; read-only uploadStatus is dropped.
    expect(body.status.selfDeclaredMadeForKids).toBe(false);
    expect(body.status.license).toBe("youtube");
    expect(body.status.embeddable).toBe(true);
    expect(body.status.publicStatsViewable).toBe(true);
    expect(body.status.uploadStatus).toBeUndefined();
  });

  it("updatePrivacy throws when the video id is not found", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch;
    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(uploader.updatePrivacy("MISSING", "public")).rejects.toThrow(/no video with id/);
  });

  it("updatePrivacy surfaces a scope/permission error from the PUT", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init || init.method === undefined || init.method === "GET") {
        return new Response(
          JSON.stringify({ items: [{ status: { privacyStatus: "unlisted" } }] }),
          { status: 200 },
        );
      }
      return new Response('{"error":{"message":"insufficient scope"}}', { status: 403 });
    }) as unknown as typeof fetch;
    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(uploader.updatePrivacy("VID", "public")).rejects.toThrow(/403.*insufficient scope/);
  });

  it("listRecentUploads resolves the uploads playlist and maps its items", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/channels")) {
        return new Response(
          JSON.stringify({
            items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_PLAYLIST" } } }],
          }),
          { status: 200 },
        );
      }
      // playlistItems
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                title: "Newest",
                publishedAt: "2026-10-01T13:00:00Z",
                resourceId: { videoId: "VNEW" },
              },
              status: { privacyStatus: "unlisted" },
            },
            {
              // An item without a videoId is skipped.
              snippet: { title: "Broken", publishedAt: "2026-10-01T12:00:00Z" },
              status: { privacyStatus: "public" },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({ getAccessToken: async () => "tok", fetch: fetchImpl });
    const uploads = await uploader.listRecentUploads();

    expect(uploads).toEqual([
      {
        videoId: "VNEW",
        title: "Newest",
        publishedAt: "2026-10-01T13:00:00Z",
        privacy: "unlisted",
      },
    ]);
    expect(calls[0]).toContain("/channels");
    expect(calls[1]).toContain("playlistId=UU_PLAYLIST");
  });

  it("listRecentUploads surfaces a scope error (youtube.upload-only token)", async () => {
    const fetchImpl = (async () =>
      new Response('{"error":{"message":"insufficient scope"}}', {
        status: 403,
      })) as unknown as typeof fetch;
    const uploader = new YouTubeUploader({ getAccessToken: async () => "t", fetch: fetchImpl });
    await expect(uploader.listRecentUploads()).rejects.toThrow(/403.*insufficient scope/);
  });

  it("still returns the video URL when the thumbnail set fails (non-fatal)", async () => {
    const warnings: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ id: "VID777" }), { status: 201 });
      }
      // The initiate call has a JSON string body; the thumbnail call has bytes.
      if (typeof init?.body === "string") {
        return new Response(null, { status: 200, headers: { location: SESSION_URI } });
      }
      // Thumbnail set fails (e.g. channel not eligible).
      return new Response("not eligible for custom thumbnails", { status: 403 });
    }) as unknown as typeof fetch;

    const uploader = new YouTubeUploader({
      getAccessToken: async () => "t",
      fetch: fetchImpl,
      logger: (m) => warnings.push(m),
    });
    const result = await uploader.upload({
      fileBytes: Buffer.from("x"),
      metadata,
      thumbnail: { bytes: Buffer.from("img"), mime: "image/png" },
    });

    expect(result).toEqual({ videoId: "VID777", url: "https://youtu.be/VID777" });
    expect(warnings.some((w) => /Thumbnail not set/.test(w))).toBe(true);
  });
});
