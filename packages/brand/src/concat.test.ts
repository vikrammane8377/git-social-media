import { describe, it, expect } from "vitest";
import { buildConcatArgs } from "./concat.js";

const base = {
  firstPath: "/tmp/main.mp4",
  secondPath: "/tmp/outro.mp4",
  outPath: "/tmp/out.mp4",
};

function filterGraph(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1];
}

describe("buildConcatArgs", () => {
  it("normalises both segments to the probed main params", () => {
    const graph = filterGraph(
      buildConcatArgs({
        ...base,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
        firstHasAudio: false,
        secondHasAudio: false,
      }),
    );
    // Both video branches get the same fps/scale/setsar/format.
    expect(graph.match(/fps=30,scale=1080:1920,setsar=1,format=yuv420p/g) ?? []).toHaveLength(2);
    expect(base.firstPath).toBe("/tmp/main.mp4");
  });

  it("concatenates video-only when the main clip has no audio", () => {
    const args = buildConcatArgs({
      ...base,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      firstHasAudio: true, // ignored: the target has no audio
      secondHasAudio: true,
    });
    expect(filterGraph(args)).toContain("concat=n=2:v=1:a=0");
    expect(args).not.toContain("anullsrc");
    expect(args).not.toContain("-c:a");
  });

  it("concatenates audio from both clips when both carry a track", () => {
    const args = buildConcatArgs({
      ...base,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p", sampleRate: 44100, channels: 2 },
      firstHasAudio: true,
      secondHasAudio: true,
    });
    const graph = filterGraph(args);
    expect(graph).toContain("concat=n=2:v=1:a=1");
    expect(graph.match(/aresample=44100/g) ?? []).toHaveLength(2);
    expect(args).not.toContain("anullsrc");
    expect(args).toContain("aac");
  });

  it("synthesises a matched silent track for a segment that lacks audio", () => {
    const args = buildConcatArgs({
      ...base,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p", sampleRate: 48000, channels: 1 },
      firstHasAudio: true,
      secondHasAudio: false,
      secondDurationSeconds: 3,
    });
    const joined = args.join(" ");
    // One real branch (main) + one silent branch (outro), bounded to its duration.
    expect(joined).toContain("anullsrc=channel_layout=mono:sample_rate=48000");
    const t = args.indexOf("-t");
    expect(t).toBeGreaterThanOrEqual(0);
    expect(args[t + 1]).toBe("3");
    expect(filterGraph(args)).toContain("concat=n=2:v=1:a=1");
  });
});
