import { execFileSync } from "node:child_process";

/**
 * Thin wrapper around the ffmpeg binary. The brand package shells out to ffmpeg
 * for all compositing (thumbnails, end-cards, outro concat) rather than taking a
 * native npm dependency like `sharp`: one tool, nothing to compile, and
 * `drawtext` accepts an explicit `fontfile=` so there is no fontconfig guesswork.
 *
 * The binary is resolved from `FFMPEG_PATH` (so the VM can pin an absolute path)
 * and falls back to `ffmpeg` on PATH. Every call site treats failures as
 * NON-FATAL: if ffmpeg is missing or a command fails, the orchestrator keeps the
 * raw still / uncaptioned clip and warns, so a clip always publishes.
 */

/** Resolve the ffmpeg binary: `FFMPEG_PATH` env wins, else `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "ffmpeg";
}

/** Resolve the ffprobe binary: `FFPROBE_PATH` env wins, else `ffprobe` on PATH. */
export function ffprobePath(): string {
  const fromEnv = process.env.FFPROBE_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "ffprobe";
}

/** True when ffmpeg can be invoked (used to gate the optional brand steps). */
export function isAvailable(): boolean {
  try {
    execFileSync(ffmpegPath(), ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Run ffmpeg with the given argv, throwing a clear error if it is missing/fails. */
export function run(args: readonly string[]): void {
  try {
    execFileSync(ffmpegPath(), [...args], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      throw new Error(
        `ffmpeg not found (looked for "${ffmpegPath()}"). Install it (brew install ffmpeg / ` +
          `apt-get install -y ffmpeg) or set FFMPEG_PATH.`,
      );
    }
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`ffmpeg failed${stderr ? `: ${stderr}` : ` (${String(err)})`}`);
  }
}

/** The main clip's parameters, probed so the outro end-card can match them. */
export interface ClipParams {
  width: number;
  height: number;
  /** Frames per second (evaluated from the `r_frame_rate` fraction). */
  fps: number;
  /** Pixel format, e.g. "yuv420p". */
  pixelFormat: string;
  /** Audio sample rate in Hz (e.g. 44100), or undefined when there is no audio. */
  sampleRate?: number;
  /** Audio channel count (e.g. 2), or undefined when there is no audio. */
  channels?: number;
}

/** Parse ffprobe's `r_frame_rate` fraction ("30000/1001") into a number. */
export function parseFrameRate(value: string): number {
  const trimmed = value.trim();
  if (trimmed.includes("/")) {
    const [num, den] = trimmed.split("/");
    const n = Number(num);
    const d = Number(den);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return n / d;
  }
  const direct = Number(trimmed);
  return Number.isFinite(direct) && direct > 0 ? direct : 30;
}

/** ffprobe JSON shape we read (only the fields we use). */
interface ProbeJson {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

/** Build the probed {@link ClipParams} from a parsed ffprobe JSON document. Pure. */
export function parseProbe(json: ProbeJson): ClipParams {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("ffprobe found no video stream in the clip.");
  const params: ClipParams = {
    width: video.width ?? 1080,
    height: video.height ?? 1920,
    fps: parseFrameRate(video.r_frame_rate ?? "30"),
    pixelFormat: video.pix_fmt ?? "yuv420p",
  };
  if (audio) {
    const rate = Number(audio.sample_rate);
    if (Number.isFinite(rate) && rate > 0) params.sampleRate = rate;
    if (typeof audio.channels === "number" && audio.channels > 0) params.channels = audio.channels;
  }
  return params;
}

/** Probe a clip's video/audio params via ffprobe so the end-card can match them. */
export function probe(videoPath: string): ClipParams {
  let out: string;
  try {
    out = execFileSync(
      ffprobePath(),
      [
        "-v",
        "error",
        "-show_streams",
        "-print_format",
        "json",
        videoPath,
      ],
      { encoding: "utf8" },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      throw new Error(
        `ffprobe not found (looked for "${ffprobePath()}"). It ships with ffmpeg; install ffmpeg ` +
          `or set FFPROBE_PATH.`,
      );
    }
    throw new Error(`ffprobe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseProbe(JSON.parse(out) as ProbeJson);
}
