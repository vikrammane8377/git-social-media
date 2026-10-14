import { describe, it, expect } from "vitest";
import { buildBadgeOverlayArgs, buildBadgesOverlayArgs } from "./overlay.js";

const base = {
  videoPath: "/tmp/outro.mp4",
  badgePath: "/tmp/banner.png",
  outPath: "/tmp/branded.mp4",
};

function filterGraph(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1];
}

describe("buildBadgeOverlayArgs", () => {
  it("takes the clip and the banner as the two inputs", () => {
    const args = buildBadgeOverlayArgs({
      ...base,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
    });
    expect(args).toContain("/tmp/outro.mp4");
    expect(args).toContain("/tmp/banner.png");
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args[args.length - 1]).toBe("/tmp/branded.mp4");
  });

  it("overlays the banner centred as a lower-third and re-encodes to the params", () => {
    const graph = filterGraph(
      buildBadgeOverlayArgs({
        ...base,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      }),
    );
    expect(graph).toContain("overlay=x=(W-w)/2:y=H-h-");
    expect(graph).toContain("scale=1080:1920");
    expect(graph).toContain("fps=30");
    expect(graph).toContain("format=yuv420p");
  });

  it("copies the spoken-CTA audio through untouched", () => {
    const args = buildBadgeOverlayArgs({
      ...base,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p", sampleRate: 44100, channels: 2 },
    });
    // The clip's audio is mapped optionally and copied, never re-encoded.
    expect(args).toContain("0:a?");
    const ca = args.indexOf("-c:a");
    expect(ca).toBeGreaterThanOrEqual(0);
    expect(args[ca + 1]).toBe("copy");
  });
});

const badgesBase = {
  videoPath: "/tmp/main.mp4",
  appStorePath: "/tmp/appstore.png",
  playStorePath: "/tmp/playstore.png",
  outPath: "/tmp/badged.mp4",
  startSeconds: 22,
};

describe("buildBadgesOverlayArgs", () => {
  it("takes the clip and BOTH store badges as the three inputs", () => {
    const args = buildBadgesOverlayArgs({
      ...badgesBase,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
    });
    expect(args).toContain("/tmp/main.mp4");
    expect(args).toContain("/tmp/appstore.png");
    expect(args).toContain("/tmp/playstore.png");
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
    expect(args[args.length - 1]).toBe("/tmp/badged.mp4");
  });

  it("stacks the two badges side-by-side, centred near the bottom", () => {
    const graph = filterGraph(
      buildBadgesOverlayArgs({
        ...badgesBase,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      }),
    );
    expect(graph).toContain("hstack=inputs=2");
    // Resting position: centred, one bottom-margin (115 = 6% of 1920) up.
    expect(graph).toContain("overlay=x=(W-w)/2:y='(H-h-115)+");
    expect(graph).toContain("scale=1080:1920");
    expect(graph).toContain("fps=30");
    expect(graph).toContain("format=yuv420p");
  });

  it("slides the badges up with an ease-out curve on the tail", () => {
    const graph = filterGraph(
      buildBadgesOverlayArgs({
        ...badgesBase,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      }),
    );
    // Quadratic ease-out offset that decays to 0 over the 0.6s entrance from t=22.
    expect(graph).toContain("(h+115)*pow(1-min(1,max(0,(t-22)/0.6)),2)");
  });

  it("gates the badges to the CTA tail with enable=gte(t,start)", () => {
    const graph = filterGraph(
      buildBadgesOverlayArgs({
        ...badgesBase,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      }),
    );
    expect(graph).toContain("enable='gte(t,22)'");
  });

  it("clamps a negative startSeconds to 0", () => {
    const graph = filterGraph(
      buildBadgesOverlayArgs({
        ...badgesBase,
        startSeconds: -5,
        params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
      }),
    );
    expect(graph).toContain("enable='gte(t,0)'");
  });

  it("copies the spoken-CTA audio through untouched", () => {
    const args = buildBadgesOverlayArgs({
      ...badgesBase,
      params: { width: 1080, height: 1920, fps: 30, pixelFormat: "yuv420p" },
    });
    expect(args).toContain("0:a?");
    const ca = args.indexOf("-c:a");
    expect(ca).toBeGreaterThanOrEqual(0);
    expect(args[ca + 1]).toBe("copy");
  });
});
