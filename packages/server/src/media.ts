import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { FileStorage } from "@bix/storage";

/**
 * Serves generated artefacts to the dashboard, read-only and path-guarded.
 *
 * Two things the UI needs:
 *  - `readReport(key)`  — markdown/JSON reports written under `outputs/`.
 *  - `videoRange(key, range)` — MP4 bytes with HTTP range support so a
 *    `<video>` element can seek without downloading the whole 10-86 MB file.
 *
 * Every key must live under `outputs/` and carry an allowed extension; the
 * underlying {@link FileStorage} additionally blocks path traversal, so a
 * request can never read outside the project's outputs tree.
 */

const REPORT_EXTS = [".md", ".json"] as const;
const VIDEO_EXTS = [".mp4", ".webm", ".mov"] as const;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export interface ReportResult {
  readonly text: string;
  readonly contentType: string;
}

export interface ImageResult {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface RangeResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export class MediaAccessError extends Error {
  constructor(
    message: string,
    /** HTTP status the route should surface. */
    readonly status: number,
  ) {
    super(message);
    this.name = "MediaAccessError";
  }
}

function assertKey(
  key: string,
  exts: readonly string[],
  prefix = "outputs/",
): void {
  if (!key || key.includes("\0")) {
    throw new MediaAccessError("Invalid key.", 400);
  }
  // Normalise separators; storage keys are forward-slash relative paths.
  const normalised = key.replace(/\\/g, "/");
  if (!normalised.startsWith(prefix)) {
    throw new MediaAccessError(`Key must live under ${prefix}.`, 403);
  }
  const lower = normalised.toLowerCase();
  if (!exts.some((ext) => lower.endsWith(ext))) {
    throw new MediaAccessError(
      `Key must end with one of: ${exts.join(", ")}.`,
      403,
    );
  }
}

function imageContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function reportContentType(key: string): string {
  return key.toLowerCase().endsWith(".json")
    ? "application/json; charset=utf-8"
    : "text/markdown; charset=utf-8";
}

function videoContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

/** Parse a single-range `Range` header. Returns null for "no range". */
export function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start > end || start >= size) return "invalid";
  if (end >= size) end = size - 1;
  return { start, end };
}

export class MediaService {
  constructor(private readonly storage: FileStorage) {}

  /** Read a whitelisted report file as text. Throws {@link MediaAccessError}. */
  readReport(key: string): ReportResult {
    assertKey(key, REPORT_EXTS);
    if (!this.storage.exists(key)) {
      throw new MediaAccessError("Report not found.", 404);
    }
    return {
      text: this.storage.read(key).toString("utf8"),
      contentType: reportContentType(key),
    };
  }

  /** Read a whitelisted image asset (under assets/uploads/) as bytes. */
  readImage(key: string): ImageResult {
    assertKey(key, IMAGE_EXTS, "assets/uploads/");
    if (!this.storage.exists(key)) {
      throw new MediaAccessError("Image not found.", 404);
    }
    return {
      bytes: this.storage.read(key),
      contentType: imageContentType(key),
    };
  }

  /**
   * Return an MP4 (or webm/mov) with HTTP range support: 206 for a valid range,
   * 200 for the whole file, 416 for an unsatisfiable range.
   */
  videoRange(key: string, rangeHeader: string | null | undefined): RangeResult {
    assertKey(key, VIDEO_EXTS);
    if (!this.storage.exists(key)) {
      throw new MediaAccessError("Video not found.", 404);
    }
    const path = this.storage.localPath(key);
    const size = statSync(path).size;
    const contentType = videoContentType(key);

    const parsed = parseRange(rangeHeader, size);

    if (parsed === "invalid") {
      return {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
        },
        body: Buffer.alloc(0),
      };
    }

    if (parsed === null) {
      // No range: return the whole file.
      return {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
        },
        body: readSlice(path, 0, size),
      };
    }

    const { start, end } = parsed;
    const length = end - start + 1;
    return {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
      body: readSlice(path, start, length),
    };
  }
}

/** Read `length` bytes from `path` starting at `start` into a Buffer. */
function readSlice(path: string, start: number, length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    return read === length ? buf : buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}
