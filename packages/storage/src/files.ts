import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

/**
 * A storage interface for binary assets and generated outputs. Today it is
 * backed by the local filesystem; later it can be re-implemented on Cloud
 * Storage without touching callers. Keys are forward-slash relative paths,
 * e.g. "assets/character-reference.png" or "outputs/video/clip-01.mp4".
 */
export interface FileStorage {
  write(key: string, data: Buffer | string): void;
  read(key: string): Buffer;
  exists(key: string): boolean;
  delete(key: string): void;
  /**
   * The concrete local path for a key. Useful now for tools that need a real
   * path (e.g. ffmpeg); a cloud implementation may not support this.
   */
  localPath(key: string): string;
}

/** Local-filesystem implementation of {@link FileStorage}, rooted at a base dir. */
export class LocalFileStorage implements FileStorage {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
    mkdirSync(this.baseDir, { recursive: true });
  }

  private resolveKey(key: string): string {
    if (isAbsolute(key)) {
      throw new Error(`Storage key must be relative, got absolute path: ${key}`);
    }
    const full = normalize(join(this.baseDir, key));
    // Guard against path traversal escaping the base directory.
    if (full !== this.baseDir && !full.startsWith(this.baseDir + sep)) {
      throw new Error(`Storage key escapes base directory: ${key}`);
    }
    return full;
  }

  write(key: string, data: Buffer | string): void {
    const full = this.resolveKey(key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }

  read(key: string): Buffer {
    return readFileSync(this.resolveKey(key));
  }

  exists(key: string): boolean {
    return existsSync(this.resolveKey(key));
  }

  delete(key: string): void {
    rmSync(this.resolveKey(key), { force: true });
  }

  localPath(key: string): string {
    return this.resolveKey(key);
  }
}
