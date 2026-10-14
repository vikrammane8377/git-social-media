import { describe, it, expect } from "vitest";
import { buildOutroArgs } from "./outro.js";
import { parseFrameRate, parseProbe } from "./ffmpeg.js";

const videoOnly = {
  videoPath: "/tmp/clip.mp4",
  endCardPath: "/tmp/endcard.png",
  outPath: "/tmp/out.mp4",
  durationSeconds: 2.5,
  params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
};

function filterGraph(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1];
}

describe("buildOutroArgs", () => {
  it("loops the end-card still for the requested duration", () => {
    const args = buildOutroArgs(videoOnly);
    const loopIdx = args.indexOf("-loop");
    expect(loopIdx).toBeGreaterThanOrEqual(0);
    expect(args).toContain("2.5");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
  });

  it("matches the probed video params on both segments", () => {
    const graph = filterGraph(buildOutroArgs(videoOnly));
    expect(graph).toContain("scale=1080:1920");
    expect(graph).toContain("fps=30");
    expect(graph).toContain("format=yuv420p");
  });

  it("concatenates video-only when the clip has no audio", () => {
    const args = buildOutroArgs(videoOnly);
    expect(filterGraph(args)).toContain("concat=n=2:v=1:a=0");
    // No lavfi silent source, no audio codec.
    expect(args).not.toContain("anullsrc");
    expect(args).not.toContain("-c:a");
  });

  it("adds a matched silent track and concatenates audio when the clip has audio", () => {
    const args = buildOutroArgs({
      ...videoOnly,
      params: { ...videoOnly.params, sampleRate: 44100, channels: 2 },
    });
    const joined = args.join(" ");
    expect(joined).toContain("anullsrc=channel_layout=stereo:sample_rate=44100");
    expect(filterGraph(args)).toContain("concat=n=2:v=1:a=1");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
  });
});

describe("parseFrameRate", () => {
  it("evaluates a fraction", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("30/1")).toBe(30);
  });

  it("falls back to 30 on bad input", () => {
    expect(parseFrameRate("abc")).toBe(30);
    expect(parseFrameRate("30/0")).toBe(30);
  });
});

describe("parseProbe", () => {
  it("reads video params and detects audio", () => {
    const params = parseProbe({
      streams: [
        { codec_type: "video", width: 720, height: 1280, r_frame_rate: "24/1", pix_fmt: "yuv420p" },
        { codec_type: "audio", sample_rate: "48000", channels: 1 },
      ],
    });
    expect(params).toEqual({
      width: 720,
      height: 1280,
      fps: 24,
      pixelFormat: "yuv420p",
      sampleRate: 48000,
      channels: 1,
    });
  });

  it("omits audio fields when there is no audio stream", () => {
    const params = parseProbe({
      streams: [{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }],
    });
    expect(params.sampleRate).toBeUndefined();
    expect(params.channels).toBeUndefined();
  });

  it("throws when there is no video stream", () => {
    expect(() => parseProbe({ streams: [{ codec_type: "audio" }] })).toThrow();
  });
});
