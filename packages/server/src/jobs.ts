import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { RunKind, RunRecord, RunsStore } from "./runs-store.js";

/**
 * Triggers pipeline actions by spawning the EXACT CLI as a child process — the
 * same verified code paths a human runs, including the reviewer gate before any
 * credits are spent. We never re-implement pipeline logic here; we only capture
 * the child's output line-by-line, persist it to the `runs` table, and fan it
 * out to live SSE subscribers.
 *
 * Because the CLI writes to the same WAL SQLite DB, structured results (script
 * decision, video status, YouTube URL) are read back through the normal read
 * endpoints as the run progresses.
 */

/** A minimal view of the spawn API so tests can inject a fake. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcess;

export interface StartOptions {
  slotId?: string;
  provider?: string;
  privacy?: string;
  maxRevisions?: number;
  /** Prompt file for `generate` (written by the script step). */
  promptFile?: string;
  /** Reference image for `generate` (single). Superseded by `refs` when set. */
  ref?: string;
  /** Reference images for `generate`/`orchestrate` (multi-image). */
  refs?: string[];
  /** Storage key of the finished MP4 for `publish`. */
  file?: string;
}

export type RunEvent =
  | { type: "log"; line: string }
  | { type: "status"; status: RunRecord["status"]; exitCode: number | null };

type Listener = (event: RunEvent) => void;

export interface JobManagerDeps {
  store: RunsStore;
  /** Repo root: the child's cwd, so data/ and outputs/ resolve as in the CLI. */
  root: string;
  /** Override the spawn implementation (tests inject a fake). */
  spawn?: SpawnFn;
  /** "dev" runs `tsx apps/cli/src/index.ts`; "prod" runs the built JS. */
  mode?: "dev" | "prod";
}

/** Map a run kind + options to the CLI argv it corresponds to. */
export function buildCliArgs(kind: RunKind, opts: StartOptions): string[] {
  switch (kind) {
    case "script": {
      const args = ["script"];
      if (opts.slotId) args.push("--slot", opts.slotId);
      if (opts.provider) args.push("--provider", opts.provider);
      if (opts.maxRevisions != null) args.push("--max-revisions", String(opts.maxRevisions));
      return args;
    }
    case "generate": {
      const args = ["video"];
      args.push("--provider", opts.provider ?? "wan");
      if (opts.promptFile) args.push("--prompt-file", opts.promptFile);
      // Multi-image: one --ref per reference. Fall back to the single `ref`, then
      // the default stand image, so an empty library keeps today's behavior.
      const refs =
        opts.refs && opts.refs.length > 0
          ? opts.refs
          : [opts.ref ?? "assets/bix_stand.png"];
      for (const ref of refs) args.push("--ref", ref);
      return args;
    }
    case "publish": {
      const args = ["youtube", "upload"];
      if (opts.file) args.push("--file", opts.file);
      if (opts.slotId) args.push("--slot", opts.slotId);
      args.push("--privacy", opts.privacy ?? "public");
      return args;
    }
    case "orchestrate": {
      const args = ["orchestrate"];
      if (opts.slotId) args.push("--slot", opts.slotId);
      if (opts.provider) args.push("--provider", opts.provider);
      args.push("--privacy", opts.privacy ?? "public");
      if (opts.maxRevisions != null) args.push("--max-revisions", String(opts.maxRevisions));
      // Only forward explicit refs when provided; otherwise the CLI writes the
      // script fresh and auto-selects assets itself (or falls back to default).
      if (opts.refs && opts.refs.length > 0) {
        for (const ref of opts.refs) args.push("--ref", ref);
      }
      return args;
    }
  }
}

export class JobManager {
  private readonly store: RunsStore;
  private readonly root: string;
  private readonly spawnFn: SpawnFn;
  private readonly mode: "dev" | "prod";
  private readonly subscribers = new Map<string, Set<Listener>>();

  constructor(deps: JobManagerDeps) {
    this.store = deps.store;
    this.root = deps.root;
    this.spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.mode = deps.mode ?? (process.env.NODE_ENV === "production" ? "prod" : "dev");
  }

  /** The command + leading args that invoke the CLI, per mode. */
  private cliInvocation(): { command: string; prefix: string[] } {
    if (this.mode === "prod") {
      return { command: "node", prefix: [join("apps", "cli", "dist", "index.js")] };
    }
    // Dev: run the TypeScript entry directly with tsx via npx (no build needed).
    return { command: "npx", prefix: ["tsx", join("apps", "cli", "src", "index.ts")] };
  }

  /**
   * Start a run: create the DB row, spawn the CLI, stream output. Returns the
   * new run's record immediately (status RUNNING); callers poll the read
   * endpoints or subscribe to the SSE stream for progress.
   */
  start(kind: RunKind, opts: StartOptions): RunRecord {
    const id = randomUUID();
    const args = buildCliArgs(kind, opts);
    const record = this.store.create({
      id,
      kind,
      slotId: opts.slotId ?? null,
      args,
    });

    const { command, prefix } = this.cliInvocation();
    const child = this.spawnFn(command, [...prefix, ...args], {
      cwd: this.root,
      env: process.env,
    });

    this.pipe(id, child);
    return record;
  }

  /** Wire a child's stdout/stderr into the run log + subscribers. */
  private pipe(runId: string, child: ChildProcess): void {
    let stdoutBuf = "";
    let stderrBuf = "";

    const handleChunk = (buf: string, data: unknown): string => {
      buf += String(data);
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        this.emitLine(runId, line);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
      return buf;
    };

    child.stdout?.on("data", (d) => {
      stdoutBuf = handleChunk(stdoutBuf, d);
    });
    child.stderr?.on("data", (d) => {
      stderrBuf = handleChunk(stderrBuf, d);
    });

    const finalize = (code: number | null): void => {
      // Flush any trailing partial lines.
      if (stdoutBuf.length > 0) this.emitLine(runId, stdoutBuf);
      if (stderrBuf.length > 0) this.emitLine(runId, stderrBuf);
      const status = code === 0 ? "SUCCEEDED" : "FAILED";
      this.store.finish(runId, status, code);
      this.dispatch(runId, { type: "status", status, exitCode: code });
      this.subscribers.delete(runId);
    };

    child.on("error", (err) => {
      this.emitLine(runId, `spawn error: ${err instanceof Error ? err.message : String(err)}`);
      finalize(1);
    });
    child.on("close", (code) => finalize(code));
  }

  private emitLine(runId: string, line: string): void {
    this.store.appendLog(runId, line + "\n");
    this.dispatch(runId, { type: "log", line });
  }

  private dispatch(runId: string, event: RunEvent): void {
    const set = this.subscribers.get(runId);
    if (!set) return;
    for (const listener of set) listener(event);
  }

  /** Subscribe to a run's live events. Returns an unsubscribe function. */
  subscribe(runId: string, listener: Listener): () => void {
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(listener);
    return () => {
      const s = this.subscribers.get(runId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.subscribers.delete(runId);
    };
  }
}
