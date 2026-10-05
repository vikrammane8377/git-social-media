import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadEnv } from "@bix/config";
import { SqliteDatabase, LocalFileStorage, type Database } from "@bix/storage";
import {
  startLogin,
  load,
  getAccessToken,
  NeedsLoginError,
  YouTubeUploader,
  YouTubeUploadStore,
  PlanSlotReader,
  slotToMetadata,
  DEFAULT_CATEGORY_ID,
  type PlanSlotRecord,
  type MetadataOverrides,
  type ThumbnailImage,
  type ChannelUpload,
  type YouTubeUploadRecord,
} from "@bix/youtube";
import { mimeFromKey } from "./refs.js";

function printUsage(): void {
  console.log("Usage: bix youtube <subcommand>");
  console.log("");
  console.log("Subcommands:");
  console.log("  login   Sign in to YouTube (opens the browser to approve)");
  console.log("  status  Show the token (expiry, scope) and which channel it controls");
  console.log("  upload  Upload a generated MP4 using metadata from a plan slot");
  console.log("  update  Change an already-uploaded video's privacy (public/unlisted/private)");
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
  console.log("");
  console.log("update options (pick one of --slot / --video / --file):");
  console.log("  --slot <id>                  Flip the newest upload for this plan slot");
  console.log("  --video <youtubeId>          Flip this YouTube video id directly");
  console.log("  --file <mp4>                 Flip the upload recorded for this file");
  console.log("  --privacy <val>              public | unlisted | private (required)");
  console.log("");
  console.log("  Note: `update` needs the broader `youtube` scope — if it fails with a");
  console.log("  permission/scope error, re-run `npm run youtube -- login` once.");
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
  /** Optional storage key of an image to set as the video's custom thumbnail. */
  readonly thumbnailKey?: string;
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
 * Choose which already-uploaded channel video a stranded SUBMITTED row refers
 * to. Matches by exact title and only accepts a video published at or after the
 * upload attempt began (a 10-minute slack absorbs clock skew), so an unrelated
 * older video that happens to share a title is never adopted. Returns the
 * newest qualifying match, or null when none fits. Pure and deterministic.
 */
export function pickReconciledVideoId(
  uploads: readonly ChannelUpload[],
  title: string,
  attemptStartedIso: string,
): string | null {
  const SLACK_MS = 10 * 60 * 1000;
  const startedAt = Date.parse(attemptStartedIso);
  let best: ChannelUpload | undefined;
  for (const upload of uploads) {
    if (upload.title !== title) continue;
    const published = Date.parse(upload.publishedAt);
    if (Number.isFinite(startedAt) && Number.isFinite(published) && published < startedAt - SLACK_MS) {
      continue; // Too old to be this attempt's upload.
    }
    if (!best || Date.parse(upload.publishedAt) > Date.parse(best.publishedAt)) {
      best = upload;
    }
  }
  return best?.videoId ?? null;
}

/**
 * Try to adopt an interrupted upload instead of re-posting it. Lists the
 * channel's recent uploads and, if one matches the stranded row's title (and
 * time), marks the row COMPLETED with that video id and returns its URL. On any
 * failure to read the channel (e.g. a youtube.upload-only token) it logs and
 * returns null so the caller falls back to a normal upload.
 */
async function reconcileOrphan(
  uploader: YouTubeUploader,
  store: YouTubeUploadStore,
  orphan: YouTubeUploadRecord,
  log: (message: string) => void,
): Promise<string | null> {
  let uploads: ChannelUpload[];
  try {
    uploads = await uploader.listRecentUploads();
  } catch (err) {
    log(
      `Could not check the channel to recover the interrupted upload for slot ${orphan.slotId} ` +
        `(${err instanceof Error ? err.message : String(err)}); proceeding to upload.`,
    );
    return null;
  }
  const videoId = pickReconciledVideoId(uploads, orphan.title, orphan.createdAt);
  if (!videoId) return null;
  store.update(orphan.id, { status: "COMPLETED", youtubeVideoId: videoId, error: null });
  return `https://youtu.be/${videoId}`;
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
    const uploader = opts.uploader ?? new YouTubeUploader();

    // Self-heal an interrupted earlier run: if the newest upload for this slot
    // is a stranded SUBMITTED row (the process died after YouTube accepted the
    // video but before we recorded its id), adopt the real video from the
    // channel instead of re-uploading — which would create a duplicate.
    const orphan = uploadStore.getBySlot(slot.id);
    if (orphan && orphan.status === "SUBMITTED") {
      const url = await reconcileOrphan(uploader, uploadStore, orphan, log);
      if (url) {
        log(`Recovered an interrupted upload for slot ${slot.id}; adopted ${url} (no duplicate created).`);
        return { url, skipped: true };
      }
    }

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

    // Optional custom thumbnail: read the bytes if the key resolves to a real
    // file. A missing thumbnail is silently skipped (the upload must not fail
    // over it); the uploader itself treats a failed set as non-fatal too.
    let thumbnail: ThumbnailImage | undefined;
    if (opts.thumbnailKey && fileStorage.exists(opts.thumbnailKey)) {
      thumbnail = {
        bytes: fileStorage.read(opts.thumbnailKey),
        mime: mimeFromKey(opts.thumbnailKey),
      };
    }

    uploadStore.create({
      id: opts.storageKey,
      slotId: slot.id,
      title: metadata.title,
      privacy: metadata.privacyStatus,
      youtubeVideoId: null,
      status: "SUBMITTED",
      error: null,
    });

    try {
      log(`Uploading ${opts.storageKey} to YouTube (${metadata.privacyStatus})...`);
      const result = await uploader.upload({ fileBytes, metadata, thumbnail });
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

  // Report which channel this token actually controls, so a fresh login can be
  // confirmed to target the intended channel before anything is published.
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json()) as {
      items?: { id: string; snippet?: { title?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      console.log(`Channel: (could not fetch: ${data.error?.message ?? res.statusText})`);
    } else {
      const channel = data.items?.[0];
      console.log(
        channel
          ? `Channel: ${channel.snippet?.title ?? "(untitled)"} (${channel.id})`
          : "Channel: (this account has no YouTube channel)",
      );
    }
  } catch (err) {
    console.log(`Channel: (could not fetch: ${err instanceof Error ? err.message : String(err)})`);
  }
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

interface UpdateArgs {
  slot?: string;
  video?: string;
  file?: string;
  privacy?: string;
}

function parseUpdateArgs(argv: string[]): UpdateArgs {
  const args: UpdateArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--slot":
        args.slot = next();
        break;
      case "--video":
        args.video = next();
        break;
      case "--file":
        args.file = next();
        break;
      case "--privacy": {
        const v = next().toLowerCase();
        if (v !== "public" && v !== "unlisted" && v !== "private") {
          throw new Error(`Invalid --privacy: ${v} (use public, unlisted or private).`);
        }
        args.privacy = v;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * Flip an already-uploaded video's privacy. The target video id comes from one
 * of --video (direct), --slot (newest upload for that slot), or --file (the
 * upload recorded for that storage key); the matching youtube_uploads row (if
 * any) has its `privacy` column updated to stay in sync with YouTube.
 */
async function runUpdate(argv: string[]): Promise<number> {
  let args: UpdateArgs;
  try {
    args = parseUpdateArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    printUsage();
    return 1;
  }

  if (!args.privacy) {
    console.error("Missing required --privacy <public|unlisted|private>.\n");
    printUsage();
    return 1;
  }
  const selectors = [args.slot, args.video, args.file].filter((v) => v !== undefined);
  if (selectors.length !== 1) {
    console.error("Pick exactly one of --slot, --video or --file.\n");
    printUsage();
    return 1;
  }

  const db = new SqliteDatabase("data/bix.db");
  try {
    const uploadStore = new YouTubeUploadStore(db);
    uploadStore.init();

    // Resolve the target YouTube video id and the DB record to keep in sync.
    let videoId: string | undefined;
    let recordId: string | undefined;
    if (args.video) {
      videoId = args.video;
      recordId = undefined;
    } else {
      const record = args.slot
        ? uploadStore.getBySlot(args.slot)
        : uploadStore.get(toStorageKey(args.file!));
      if (!record) {
        console.error(
          args.slot
            ? `No upload recorded for slot "${args.slot}".`
            : `No upload recorded for file "${args.file}".`,
        );
        return 1;
      }
      if (!record.youtubeVideoId) {
        console.error(`That upload has no YouTube video id yet (status: ${record.status}).`);
        return 1;
      }
      videoId = record.youtubeVideoId;
      recordId = record.id;
    }

    const uploader = new YouTubeUploader();
    console.log(`Setting video ${videoId} to ${args.privacy}...`);
    await uploader.updatePrivacy(videoId, args.privacy);
    if (recordId) {
      uploadStore.update(recordId, { privacy: args.privacy });
    }
    console.log("");
    console.log(`Done. https://youtu.be/${videoId} is now ${args.privacy}.`);
    return 0;
  } finally {
    db.close();
  }
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
      case "update":
        return await runUpdate(argv.slice(1));
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
