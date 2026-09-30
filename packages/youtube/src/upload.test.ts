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
});
