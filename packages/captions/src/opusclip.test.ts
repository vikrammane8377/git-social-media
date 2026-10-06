import { describe, it, expect } from "vitest";
import {
  OpusClipCaptioner,
  pickExportableClip,
  aspectRatioToLayout,
  type ExportableClip,
} from "./opusclip.js";

function clip(partial: Partial<ExportableClip>): ExportableClip {
  return { id: "c", title: "t", durationMs: 1000, uriForExport: "", ...partial };
}

describe("aspectRatioToLayout", () => {
  it("maps 9:16 to portrait, 16:9 to landscape, 1:1 to square", () => {
    expect(aspectRatioToLayout("9:16")).toBe("portrait");
    expect(aspectRatioToLayout("16:9")).toBe("landscape");
    expect(aspectRatioToLayout("1:1")).toBe("square");
  });

  it("defaults to portrait on garbage input", () => {
    expect(aspectRatioToLayout("not-a-ratio")).toBe("portrait");
  });
});

describe("pickExportableClip", () => {
  it("returns the first clip with a non-empty export URI", () => {
    const clips = [clip({ id: "A", uriForExport: "" }), clip({ id: "B", uriForExport: "https://x/b.mp4" })];
    expect(pickExportableClip(clips)?.id).toBe("B");
  });

  it("returns null while nothing is ready", () => {
    expect(pickExportableClip([clip({ uriForExport: "" })])).toBeNull();
    expect(pickExportableClip([])).toBeNull();
  });
});

/** A tiny fetch stub that replays queued responses and records the calls. */
function makeFetch(responses: Response[]): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const res = responses[i++];
    if (!res) throw new Error(`No stubbed response for call ${i}: ${String(input)}`);
    return res;
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("OpusClipCaptioner.caption", () => {
  it("uploads, creates a project, polls, and downloads the captioned MP4", async () => {
    const mp4 = Buffer.from("captioned-bytes");
    const { fetch, calls } = makeFetch([
      // 1. upload-links
      json({ url: "https://gcs/upload", uploadId: "UP123" }),
      // 2. resumable init -> Location header
      new Response(null, { status: 200, headers: { location: "https://gcs/session" } }),
      // 3. PUT bytes
      new Response(null, { status: 200 }),
      // 4. create project
      json({ id: "PROJ1" }),
      // 5a. poll: nothing ready
      json({ data: [], total: 0 }),
      // 5b. poll: ready
      json({ data: [{ id: "PROJ1.c1", title: "t", durationMs: 28000, uriForExport: "https://cdn/out.mp4" }] }),
      // 6. download
      new Response(mp4, { status: 200 }),
    ]);

    const sleeps: number[] = [];
    const captioner = new OpusClipCaptioner({
      apiKey: "sk-test",
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      logger: () => {},
    });

    const out = await captioner.caption(Buffer.from("raw"), {
      layoutAspectRatio: "portrait",
      sourceLang: "es",
      pollIntervalMs: 5,
    });

    expect(out.toString()).toBe("captioned-bytes");

    // Upload link requested with the LocalUpload usecase and a bearer token.
    expect(calls[0].url).toBe("https://api.opus.pro/api/upload-links");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ video: { usecase: "LocalUpload" } });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    // Resumable session opened, then bytes PUT as octet-stream.
    expect(calls[1].url).toBe("https://gcs/upload");
    expect((calls[1].init?.headers as Record<string, string>)["x-goog-resumable"]).toBe("start");
    expect(calls[2].url).toBe("https://gcs/session");
    expect(calls[2].init?.method).toBe("PUT");

    // Project created against the uploadId, whole-video, portrait, es.
    expect(calls[3].url).toBe("https://api.opus.pro/api/clip-projects");
    const projBody = JSON.parse(String(calls[3].init?.body));
    expect(projBody.videoUrl).toBe("UP123");
    expect(projBody.curationPref).toEqual({ skipCurate: true, skipSlicing: true });
    expect(projBody.renderPref).toEqual({ layoutAspectRatio: "portrait", enableCaption: true });
    expect(projBody.importPref).toEqual({ sourceLang: "es" });

    // Polled twice (one empty, one ready) and slept once between.
    expect(calls[4].url).toContain("exportable-clips");
    expect(calls[4].url).toContain("projectId=PROJ1");
    expect(sleeps).toEqual([5]);
  });

  it("surfaces an error body when the upload link request fails", async () => {
    const { fetch } = makeFetch([
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    ]);
    const captioner = new OpusClipCaptioner({ apiKey: "sk-bad", fetch, logger: () => {} });
    await expect(
      captioner.caption(Buffer.from("raw"), { layoutAspectRatio: "portrait" }),
    ).rejects.toThrow(/request an upload link \(401\): nope/);
  });

  it("gives up after maxPolls when the render never appears", async () => {
    const { fetch } = makeFetch([
      json({ url: "https://gcs/upload", uploadId: "UP" }),
      new Response(null, { status: 200, headers: { location: "https://gcs/session" } }),
      new Response(null, { status: 200 }),
      json({ id: "PROJ" }),
      json({ data: [] }),
      json({ data: [] }),
    ]);
    const captioner = new OpusClipCaptioner({
      apiKey: "sk",
      fetch,
      sleep: async () => {},
      logger: () => {},
    });
    await expect(
      captioner.caption(Buffer.from("raw"), {
        layoutAspectRatio: "portrait",
        pollIntervalMs: 1,
        maxPolls: 2,
      }),
    ).rejects.toThrow(/did not finish captioning project PROJ within 2 polls/);
  });
});
