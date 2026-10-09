/**
 * Cron-friendly daily runner. One Short ships per channel per day — the Spanish
 * channel and the Global channel each get their own slot (a free event/competitor
 * mix) — so each cron entry targets a single `--channel` and runs the full
 * {@link runOrchestrate} pipeline (script -> video -> captions -> public YouTube)
 * for that day's slot on that channel.
 *
 * Selection is strictly by plan date: it looks at the slots scheduled for the
 * given date (default: today, local time), filters to the requested channel,
 * skips any that are already published, and runs the earliest remaining one.
 * When there is nothing to do (no slot scheduled, or all already published) it
 * logs a line and exits 0, so a scheduler never treats a quiet day as a failure.
 */
import { resolve } from "node:path";
import { enabledChannels, isChannelId, type ChannelId } from "@bix/config";
import { SqliteDatabase } from "@bix/storage";
import { PlanSlotReader, YouTubeUploadStore, type PlanSlotRecord } from "@bix/youtube";
import { runOrchestrate } from "./orchestrate.js";

interface RunDailyArgs {
  /** When set, run only this channel; otherwise run every enabled channel. */
  channel?: ChannelId;
  /** YYYY-MM-DD; defaults to today in local time. */
  date?: string;
  privacy: string;
  provider?: string;
  maxRevisions?: string;
  captions: boolean;
  /** Resolve and print the chosen slots without running the pipeline. */
  dryRun: boolean;
}

/** Format a Date as a local-time YYYY-MM-DD string (no timezone shift). */
export function todayLocalISODate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Outcome of picking a slot for one source on a date. */
export type SlotChoice =
  | { kind: "run"; slot: PlanSlotRecord }
  | { kind: "skip"; reason: string };

/**
 * Pure selection: from the day's slots, keep those on `channel`, and return the
 * earliest one that is not already published. `isCompleted` reports whether a
 * slot id already has a COMPLETED upload. Slots are assumed to arrive in
 * schedule order (PlanSlotReader.getByDate sorts by time then id).
 */
export function chooseSlot(
  slots: readonly PlanSlotRecord[],
  channel: ChannelId,
  isCompleted: (slotId: string) => boolean,
): SlotChoice {
  const matching = slots.filter((s) => s.channel === channel);
  if (matching.length === 0) {
    return { kind: "skip", reason: `no ${channel} slot scheduled` };
  }
  const pending = matching.find((s) => !isCompleted(s.id));
  if (!pending) {
    return { kind: "skip", reason: `${channel} slot already published` };
  }
  return { kind: "run", slot: pending };
}

function parseArgs(argv: string[]): RunDailyArgs {
  const args: RunDailyArgs = { privacy: "public", captions: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--channel": {
        const v = next().toLowerCase();
        if (!isChannelId(v)) {
          throw new Error(`Invalid --channel: ${v} (use spanish or global).`);
        }
        args.channel = v;
        break;
      }
      case "--date":
        args.date = next();
        break;
      case "--privacy": {
        const v = next().toLowerCase();
        if (v !== "public" && v !== "unlisted" && v !== "private") {
          throw new Error(`Invalid --privacy: ${v} (use public, unlisted or private).`);
        }
        args.privacy = v;
        break;
      }
      case "--provider":
        args.provider = next();
        break;
      case "--max-revisions":
        args.maxRevisions = next();
        break;
      case "--no-captions":
        args.captions = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log("Usage: npm run run-daily -- [--channel spanish|global] [options]");
  console.log("");
  console.log("Runs the day's scheduled Short(s) end-to-end (script -> video -> captions ->");
  console.log("public YouTube). Picks the slot strictly by plan date and skips any that are");
  console.log("already published, so re-running the same day is safe and cheap.");
  console.log("");
  console.log("With --channel it runs only that channel (one cron entry per channel); without");
  console.log("it it runs every enabled channel in turn. A day with no scheduled slot exits 0");
  console.log("so a scheduler never flags a quiet day as a failure.");
  console.log("");
  console.log("Options:");
  console.log("  --channel <id>       spanish | global (default: run every enabled channel)");
  console.log("  --date <YYYY-MM-DD>  Plan date to run (default: today, local time)");
  console.log("  --privacy <val>      public | unlisted | private (default public)");
  console.log("  --provider <name>    Override the video provider (default from config)");
  console.log("  --max-revisions <n>  Override the auto-revision limit");
  console.log("  --no-captions        Skip OpusClip captioning; publish the raw clip");
  console.log("  --dry-run            Print the slots that would run; do not spend anything");
  console.log("  --help               Show this help");
}

/** Build the orchestrate argv for a resolved slot id, forwarding passthrough flags. */
function orchestrateArgv(slotId: string, args: RunDailyArgs): string[] {
  const out = ["--slot", slotId, "--privacy", args.privacy];
  if (args.provider) out.push("--provider", args.provider);
  if (args.maxRevisions) out.push("--max-revisions", args.maxRevisions);
  if (!args.captions) out.push("--no-captions");
  return out;
}

export async function runRunDaily(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  let args: RunDailyArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    printUsage();
    return 1;
  }

  const date = args.date ?? todayLocalISODate();
  const configDir = resolve(process.cwd(), "config");
  const channels: ChannelId[] = args.channel
    ? [args.channel]
    : enabledChannels(configDir).map((c) => c.id);

  // Resolve every channel's slot up front (read-only) so the plan is inspected
  // once and the DB handle is closed before the long-running pipeline begins.
  const db = new SqliteDatabase("data/bix.db");
  let plans: { channel: ChannelId; choice: SlotChoice }[];
  try {
    const reader = new PlanSlotReader(db);
    const uploads = new YouTubeUploadStore(db);
    uploads.init();
    const slots = reader.getByDate(date);
    const isCompleted = (slotId: string): boolean => {
      const record = uploads.getBySlot(slotId);
      return record?.status === "COMPLETED" && Boolean(record.youtubeVideoId);
    };
    plans = channels.map((channel) => ({ channel, choice: chooseSlot(slots, channel, isCompleted) }));
  } finally {
    db.close();
  }

  console.log(`Daily run for ${date} (${channels.join(" + ")}).`);

  let failures = 0;
  let ran = 0;
  let planned = 0;
  for (const { channel, choice } of plans) {
    console.log("");
    if (choice.kind === "skip") {
      console.log(`[${channel}] Nothing to do: ${choice.reason} for ${date}.`);
      continue;
    }
    const { slot } = choice;
    planned += 1;
    console.log(`[${channel}] ${slot.id} — ${slot.time} ${slot.format}: ${slot.topic}`);
    if (args.dryRun) {
      console.log(`[${channel}] dry run — not spending; would run orchestrate --slot ${slot.id}.`);
      continue;
    }
    ran += 1;
    const code = await runOrchestrate(orchestrateArgv(slot.id, args));
    if (code !== 0) {
      failures += 1;
      console.error(`[${channel}] slot ${slot.id} failed (exit ${code}).`);
    }
  }

  console.log("");
  if (args.dryRun) {
    console.log(`Dry run finished: ${planned} slot(s) would run.`);
    return 0;
  }
  if (failures > 0) {
    console.error(`Daily run finished with ${failures} failure(s) of ${ran} attempted.`);
    return 1;
  }
  console.log(ran === 0 ? "Daily run finished: nothing scheduled." : `Daily run finished: ${ran} published.`);
  return 0;
}
