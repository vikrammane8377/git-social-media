/**
 * Cron-friendly daily runner. Two Shorts ship per day — one from an `event`
 * slot, one from a `competitor` slot — so each cron entry targets a single
 * `--source` and runs the full {@link runOrchestrate} pipeline (script ->
 * video -> captions -> public YouTube) for that day's slot.
 *
 * Selection is strictly by plan date: it looks at the slots scheduled for the
 * given date (default: today, local time), filters to the requested source,
 * skips any that are already published, and runs the earliest remaining one.
 * When there is nothing to do (no slot scheduled, or all already published) it
 * logs a line and exits 0, so a scheduler never treats a quiet day as a failure.
 */
import { SqliteDatabase } from "@bix/storage";
import { PlanSlotReader, YouTubeUploadStore, type PlanSlotRecord } from "@bix/youtube";
import { runOrchestrate } from "./orchestrate.js";

/** The two content tracks the daily runner understands. */
export type DailySource = "event" | "competitor";

interface RunDailyArgs {
  /** When set, run only this track; otherwise run event then competitor. */
  source?: DailySource;
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
 * Pure selection: from the day's slots, keep those matching `source`, and
 * return the earliest one that is not already published. `isCompleted` reports
 * whether a slot id already has a COMPLETED upload. Slots are assumed to arrive
 * in schedule order (PlanSlotReader.getByDate sorts by time then id).
 */
export function chooseSlot(
  slots: readonly PlanSlotRecord[],
  source: DailySource,
  isCompleted: (slotId: string) => boolean,
): SlotChoice {
  const matching = slots.filter((s) => s.source === source);
  if (matching.length === 0) {
    return { kind: "skip", reason: `no ${source} slot scheduled` };
  }
  const pending = matching.find((s) => !isCompleted(s.id));
  if (!pending) {
    return { kind: "skip", reason: `${source} slot already published` };
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
      case "--source": {
        const v = next().toLowerCase();
        if (v !== "event" && v !== "competitor") {
          throw new Error(`Invalid --source: ${v} (use event or competitor).`);
        }
        args.source = v;
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
  console.log("Usage: npm run run-daily -- [--source event|competitor] [options]");
  console.log("");
  console.log("Runs the day's scheduled Short(s) end-to-end (script -> video -> captions ->");
  console.log("public YouTube). Picks the slot strictly by plan date and skips any that are");
  console.log("already published, so re-running the same day is safe and cheap.");
  console.log("");
  console.log("With --source it runs only that track (one cron entry per track); without it");
  console.log("it runs the event slot then the competitor slot. A day with no scheduled slot");
  console.log("exits 0 so a scheduler never flags a quiet day as a failure.");
  console.log("");
  console.log("Options:");
  console.log("  --source <track>     event | competitor (default: run both)");
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
  const sources: DailySource[] = args.source ? [args.source] : ["event", "competitor"];

  // Resolve every track's slot up front (read-only) so the plan is inspected
  // once and the DB handle is closed before the long-running pipeline begins.
  const db = new SqliteDatabase("data/bix.db");
  let plans: { source: DailySource; choice: SlotChoice }[];
  try {
    const reader = new PlanSlotReader(db);
    const uploads = new YouTubeUploadStore(db);
    uploads.init();
    const slots = reader.getByDate(date);
    const isCompleted = (slotId: string): boolean => {
      const record = uploads.getBySlot(slotId);
      return record?.status === "COMPLETED" && Boolean(record.youtubeVideoId);
    };
    plans = sources.map((source) => ({ source, choice: chooseSlot(slots, source, isCompleted) }));
  } finally {
    db.close();
  }

  console.log(`Daily run for ${date} (${sources.join(" + ")}).`);

  let failures = 0;
  let ran = 0;
  let planned = 0;
  for (const { source, choice } of plans) {
    console.log("");
    if (choice.kind === "skip") {
      console.log(`[${source}] Nothing to do: ${choice.reason} for ${date}.`);
      continue;
    }
    const { slot } = choice;
    planned += 1;
    console.log(`[${source}] ${slot.id} — ${slot.time} ${slot.format}: ${slot.topic}`);
    if (args.dryRun) {
      console.log(`[${source}] dry run — not spending; would run orchestrate --slot ${slot.id}.`);
      continue;
    }
    ran += 1;
    const code = await runOrchestrate(orchestrateArgv(slot.id, args));
    if (code !== 0) {
      failures += 1;
      console.error(`[${source}] slot ${slot.id} failed (exit ${code}).`);
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
