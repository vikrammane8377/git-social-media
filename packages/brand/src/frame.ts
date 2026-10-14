import { run } from "./ffmpeg.js";

/**
 * Extracts the final frame of a clip as a single PNG, used to seed the animated
 * Wan outro so it continues seamlessly from where the main clip ends. Seeking to
 * `-0.2s` before the end (`-sseof`) and grabbing one frame is robust against the
 * exact last-frame boundary; `-update 1` tells ffmpeg the single output image is
 * rewritten rather than treated as a numbered sequence.
 *
 * {@link buildLastFrameArgs} is pure (returns the ffmpeg argv) so it can be
 * unit-tested without ffmpeg; {@link extractLastFrame} shells out.
 */

export interface LastFrameArgsOptions {
  /** Absolute path to the source clip. */
  videoPath: string;
  /** Absolute output path for the extracted PNG. */
  outPath: string;
}

/** Compose the ffmpeg argv that writes the clip's final frame to a PNG. Pure. */
export function buildLastFrameArgs(opts: LastFrameArgsOptions): string[] {
  return [
    "-sseof",
    "-0.2",
    "-i",
    opts.videoPath,
    "-frames:v",
    "1",
    "-update",
    "1",
    "-y",
    opts.outPath,
  ];
}

/** Extract the clip's last frame to `outPath` via ffmpeg. Returns `outPath`. */
export function extractLastFrame(opts: LastFrameArgsOptions): string {
  run(buildLastFrameArgs(opts));
  return opts.outPath;
}
