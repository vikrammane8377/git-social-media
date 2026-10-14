import { describe, it, expect } from "vitest";
import { buildThumbnailArgs } from "./thumbnail.js";

const base = {
  basePath: "/tmp/base.png",
  outPath: "/tmp/thumb.png",
  width: 1080,
  height: 1920,
};

/** Grab the filter_complex graph from an argv array. */
function filterGraph(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1];
}

describe("buildThumbnailArgs", () => {
  it("scales/crops the base to fill and ends with a single PNG frame", () => {
    const args = buildThumbnailArgs({ ...base, titleLines: [] });
    const graph = filterGraph(args);
    expect(graph).toContain(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    );
    expect(args).toContain("-frames:v");
    expect(args[args.length - 1]).toBe("/tmp/thumb.png");
    // Only the base is an input when no brand layers are given.
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
  });

  it("always draws a legibility scrim", () => {
    const graph = filterGraph(buildThumbnailArgs({ ...base, titleLines: [] }));
    expect(graph).toContain("drawbox=");
  });

  it("adds drawtext only when a font and title lines exist", () => {
    const without = filterGraph(buildThumbnailArgs({ ...base, titleLines: ["Hi"] }));
    expect(without).not.toContain("drawtext=");

    const withText = filterGraph(
      buildThumbnailArgs({ ...base, titleLines: ["Hi", "there"], fontPath: "/f/title.ttf" }),
    );
    expect(withText).toContain("drawtext=");
    expect(withText).toContain("fontfile='/f/title.ttf'");
    // Multi-line title is joined with a newline.
    expect(withText).toContain("Hi\nthere");
  });

  it("adds the logo as an input and overlays it when provided", () => {
    const args = buildThumbnailArgs({ ...base, titleLines: [], logoPath: "/b/logo.png" });
    expect(args).toContain("/b/logo.png");
    expect(filterGraph(args)).toContain("overlay=");
  });

  it("overlays the single combined banner instead of the two-badge row", () => {
    const args = buildThumbnailArgs({
      ...base,
      titleLines: [],
      badgePath: "/b/banner.png",
      // Even when the legacy pair is also supplied, the banner wins.
      appStorePath: "/b/appstore.png",
      playStorePath: "/b/playstore.png",
    });
    expect(args).toContain("/b/banner.png");
    // The pair is NOT added as inputs when the banner is present.
    expect(args).not.toContain("/b/appstore.png");
    expect(args).not.toContain("/b/playstore.png");
    // base + banner = two inputs, one centred overlay.
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(filterGraph(args).match(/overlay=/g) ?? []).toHaveLength(1);
    expect(filterGraph(args)).toContain("overlay=x=(W-w)/2");
  });

  it("adds a badge row only for the badges present", () => {
    const one = buildThumbnailArgs({ ...base, titleLines: [], appStorePath: "/b/appstore.png" });
    expect(one).toContain("/b/appstore.png");
    // base + one badge = two inputs.
    expect(one.filter((a) => a === "-i")).toHaveLength(2);

    const both = buildThumbnailArgs({
      ...base,
      titleLines: [],
      appStorePath: "/b/appstore.png",
      playStorePath: "/b/playstore.png",
    });
    // base + two badges = three inputs.
    expect(both.filter((a) => a === "-i")).toHaveLength(3);
    expect(filterGraph(both).match(/overlay=/g) ?? []).toHaveLength(2);
  });

  it("maps the final labeled stream", () => {
    const args = buildThumbnailArgs({
      ...base,
      titleLines: ["Hi"],
      fontPath: "/f/title.ttf",
      logoPath: "/b/logo.png",
      appStorePath: "/b/appstore.png",
      playStorePath: "/b/playstore.png",
    });
    const mapIdx = args.indexOf("-map");
    expect(mapIdx).toBeGreaterThanOrEqual(0);
    // The mapped label must be defined somewhere in the graph.
    const label = args[mapIdx + 1].replace(/[[\]]/g, "");
    expect(filterGraph(args)).toContain(`[${label}]`);
  });
});
