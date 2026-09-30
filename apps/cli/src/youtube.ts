import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadEnv } from "@bix/config";
import { SqliteDatabase, LocalFileStorage, type Database } from "@bix/storage";
import {
  startLogin,
  load,
  NeedsLoginError,
  YouTubeUploader,
  YouTubeUploadStore,
  PlanSlotReader,
  slotToMetadata,
  DEFAULT_CATEGORY_ID,
  type PlanSlotRecord,
  type MetadataOverrides,
} from "@bix/youtube";

function printUsage(): void {
  console.log("Usage: bix youtube <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  login   Sign in to YouTube (opens the browser to approve)");
  console.log("  status  Show whether we hold a token, when it expires, and its scope");
  console.log("  upload  Upload a generated MP4 using metadata from a plan slot");
  console.log("");
  console.log("upload options:");
  console.log("  --file <mp4>                 The video to upload (required; inside the project)");
  console.log("  --slot <id>                  Plan slot id supplying the metadata");
  console.log("  --date <YYYY-MM-DD>          ...or pick the slot by date (default: today)");
  console.log("  --title <text>               Override the title");
  console.log("  --description-file <path>    Override the description from a file");
  console.log("  --tags a,b,c                 Override the tags (comma-separated)");
  console.log("  --privacy <val>              public | unlisted | private (default public)");
  console.log("  --category <id>              YouTube category id (default 27 = Education)");
  console.log("  --no-synthetic-disclosure    Do NOT declare AI-generated content (default: declare)");
}

/** Today's date as YYYY-MM-DD (local), used when --date is omitted. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve the single plan slot to use, or throw a helpful error. */
function resolveSlot(db: Database, slotId?: string, date?: string): PlanSlotRecord {
  const reader = new PlanSlotReader(db);
  if (slotId) {
    const slot = reader.getById(slotId);
    if (!slot) {
      throw new Error(
        `No plan slot found with id "${slotId}". Run scan:competitors to build a plan.`,
      );
    }
    return slot;
  }
  const day = date ?? todayIso();
  const slots = reader.getByDate(day);
  if (slots.length === 0) {
    throw new Error(
      `No plan slot scheduled on ${day}. Pass --slot <id>, or a --date that has a slot.`,
    );
  }
  if (slots.length > 1) {
    const ids = slots.map((s) => s.id).join(", ");
    throw new Error(`${slots.length} slots on ${day}; choose one with --slot: ${ids}`);
  }
  return slots[0];
}

/** Convert a user-supplied file path to a storage key relative to the project. */
function toStorageKey(file: string): string {
  const rel = relative(process.cwd(), resolve(file));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`--file must be inside the project directory: ${file}`);
  }
  return rel.split(sep).join("/");
}

export interface PublishOptions {
  /** The video's storage key, relative to the project root. Also the record id. */
  readonly storageKey: string;
  readonly slotId?: string;
  readonly date?: string;
  readonly privacy: string;
  readonly title?: string;
  readonly descriptionFile?: string;
  readonly tags?: string[];
  readonly categoryId?: string;
  readonly syntheticDisclosure: boolean;
  /** Injectable uploader (tests); defaults to a real one using the OAuth token. */
  readonly uploader?: YouTubeUploader;
  readonly logger?: (message: string) => void;
}

export interface PublishOutcome {
  readonly url: string;
  /** True when an existing completed upload was detected and reused. */
  readonly skipped: boolean;
}

/**
 * Shared publish path used by both `youtube upload` and `video --publish`:
 * reads the plan slot, builds metadata, reads the MP4, and does the resumable
 * upload - skipping if this file was already uploaded (idempotent, no double
 * post). Records every attempt in the `youtube_uploads` table.
 */
export async function publishFile(opts: PublishOptions): Promise<PublishOutcome> {
  const log = opts.logger ?? ((m: string) => console.log(m));
  const db = new SqliteDatabase("data/bix.db");
  try {
    const uploadStore = new YouTubeUploadStore(db);
    uploadStore.init();

    // Idempotency guard: a completed upload for this file already has a URL.
    const existing = uploadStore.get(opts.storageKey);
    if (existing?.status === "COMPLETED" && existing.youtubeVideoId) {
      const url = `https://youtu.be/${existing.youtubeVideoId}`;
      log(`Already uploaded; skipping to avoid a duplicate. ${url}`);
      return { url, skipped: true };
    }

    const slot = resolveSlot(db, opts.slotId, opts.date);

    const overrides: MetadataOverrides = {
      title: opts.title,
      description: opts.descriptionFile
        ? readFileSync(opts.descriptionFile, "utf8").trim()
        : undefined,
      tags: opts.tags,
      categoryId: opts.categoryId,
      privacyStatus: opts.privacy,
      containsSyntheticMedia: opts.syntheticDisclosure,
    };
    const metadata = slotToMetadata(slot, overrides);

    const fileStorage = new LocalFileStorage(process.cwd());
    if (!fileStorage.exists(opts.storageKey)) {
      throw new Error(`Video file not found: ${opts.storageKey}`);
    }
    const fileBytes = fileStorage.read(opts.storageKey);

    uploadStore.create({
      id: opts.storageKey,
      slotId: slot.id,
      title: metadata.title,
      privacy: metadata.privacyStatus,
      youtubeVideoId: null,
      status: "SUBMITTED",
      error: null,
    });

    const uploader = opts.uploader ?? new YouTubeUploader();
    try {
      log(`Uploading ${opts.storageKey} to YouTube (${metadata.privacyStatus})...`);
      const result = await uploader.upload({ fileBytes, metadata });
      uploadStore.update(opts.storageKey, {
        status: "COMPLETED",
        youtubeVideoId: result.videoId,
        error: null,
      });
      log(`Uploaded: ${result.url}`);
      return { url: result.url, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      uploadStore.update(opts.storageKey, { status: "FAILED", error: message });
      throw err;
    }
  } finally {
    db.close();
  }
}

async function runLogin(): Promise<number> {
  const handle = await startLogin();
  console.log("");
  console.log("Opening your browser to sign in to YouTube (Google). If it doesn't open,");
  console.log("paste this URL manually:");
  console.log("");
  console.log(`  ${handle.authUrl}`);
  console.log("");
  console.log("Waiting for approval...");

  // Best-effort: open the default browser (macOS `open`).
  spawn("open", [handle.authUrl], { stdio: "ignore", detached: true }).unref();

  const tokens = await handle.waitForTokens();
  const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
  console.log("");
  console.log("Signed in.");
  console.log(`Access token expires in ~${mins} min.`);
  console.log(
    `Refresh token: ${tokens.refreshToken ? "received (silent refresh enabled)" : "NOT received"}`,
  );
  console.log(`Scope: ${tokens.scope ?? "(not reported)"}`);
  return 0;
}

async function runStatus(): Promise<number> {
  const tokens = await load();
  if (!tokens) {
    console.log("Not signed in. Run: npm run youtube -- login");
    return 0;
  }
  const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
  console.log(`Signed in.`);
  console.log(`Access token ${mins > 0 ? `valid for ~${mins} min` : "expired"}.`);
  console.log(`Refresh token: ${tokens.refreshToken ? "present" : "absent"}.`);
  console.log(`Scope: ${tokens.scope ?? "(not reported)"}`);
  return 0;
}

interface UploadArgs {
  file?: string;
  slot?: string;
  date?: string;
  title?: string;
  descriptionFile?: string;
  tags?: string[];
  privacy: string;
  category?: string;
  syntheticDisclosure: boolean;
}

function parseUploadArgs(argv: string[]): UploadArgs {
  const args: UploadArgs = { privacy: "public", syntheticDisclosure: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--file":
        args.file = next();
        break;
      case "--slot":
        args.slot = next();
        break;
      case "--date":
        args.date = next();
        break;
      case "--title":
        args.title = next();
        break;
      case "--description-file":
        args.descriptionFile = next();
        break;
      case "--tags":
        args.tags = next()
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        break;
      case "--privacy": {
        const v = next().toLowerCase();
        if (v !== "public" && v !== "unlisted" && v !== "private") {
          throw new Error(`Invalid --privacy: ${v} (use public, unlisted or private).`);
        }
        args.privacy = v;
        break;
      }
      case "--category":
        args.category = next();
        break;
      case "--no-synthetic-disclosure":
        args.syntheticDisclosure = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function runUpload(argv: string[]): Promise<number> {
  let args: UploadArgs;
  try {
    args = parseUploadArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    printUsage();
    return 1;
  }

  if (!args.file) {
    console.error("Missing required --file <mp4>.\n");
    printUsage();
    return 1;
  }

  let storageKey: string;
  try {
    storageKey = toStorageKey(args.file);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const outcome = await publishFile({
    storageKey,
    slotId: args.slot,
    date: args.date,
    privacy: args.privacy,
    title: args.title,
    descriptionFile: args.descriptionFile,
    tags: args.tags,
    categoryId: args.category ?? DEFAULT_CATEGORY_ID,
    syntheticDisclosure: args.syntheticDisclosure,
  });

  console.log("");
  console.log(outcome.skipped ? "Already published (no duplicate created)." : "Published.");
  console.log(outcome.url);
  return 0;
}

export async function runYoutube(argv: string[]): Promise<number> {
  loadEnv();
  const sub = argv[0];
  try {
    switch (sub) {
      case "login":
        return await runLogin();
      case "status":
        return await runStatus();
      case "upload":
        return await runUpload(argv.slice(1));
      default:
        printUsage();
        return sub ? 1 : 0;
    }
  } catch (err) {
    if (err instanceof NeedsLoginError) {
      console.error(err.message);
      console.error("Run: npm run youtube -- login");
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
