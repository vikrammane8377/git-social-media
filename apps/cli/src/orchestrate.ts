import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadEnv, requireKey } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  PlanSlotReader,
  AssetReader,
  ScriptStore,
  OpenAiScriptWriter,
  OpenAiScriptReviewer,
  UsageTrackingClient,
  ImageGenerator,
  createOpenAiImageGenerator,
  computeCost,
  createSolClient,
  loadScriptWriterConfig,
  renderScriptReport,
  runScriptWriter,
  type ScriptResult,
  type NeededImage,
  type GeneratedImage,
} from "@bix/scripts";
import { AssetsStore } from "@bix/server";
import {
  FalSeedanceProvider,
  FalAvatarSingleTextProvider,
  FalVeo31FastProvider,
  FalKlingV3ProProvider,
  HiggsfieldWanProvider,
  VideoJobStore,
  VideoRunner,
  type VideoRequest,
  type VideoProvider,
} from "@bix/video";
import { OpusClipCaptioner, aspectRatioToLayout } from "@bix/captions";
import { publishFile } from "./youtube.js";
import { selectRefs, pickThumbnailKey, mimeFromKey, DEFAULT_REF } from "./refs.js";

type ProviderName = "wan" | "seedance" | "avatar" | "veo" | "kling";

interface OrchestrateArgs {
  slot?: string;
  date?: string;
  provider?: ProviderName;
  refs: string[];
  privacy: string;
  maxRevisions?: number;
  /** When false, skip the OpusClip captioning phase and publish the raw clip. */
  captions: boolean;
}

function parseArgs(argv: string[]): OrchestrateArgs {
  const args: OrchestrateArgs = { refs: [], privacy: "public", captions: true };
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
      case "--date":
        args.date = next();
        break;
      case "--provider": {
        const v = next().toLowerCase();
        if (v !== "wan" && v !== "seedance" && v !== "avatar" && v !== "veo" && v !== "kling") {
          throw new Error(`Invalid --provider: ${v} (use wan, seedance, avatar, veo or kling).`);
        }
        args.provider = v;
        break;
      }
      case "--ref":
        args.refs.push(next());
        break;
      case "--privacy": {
        const v = next().toLowerCase();
        if (v !== "public" && v !== "unlisted" && v !== "private") {
          throw new Error(`Invalid --privacy: ${v} (use public, unlisted or private).`);
        }
        args.privacy = v;
        break;
      }
      case "--max-revisions": {
        const v = Number(next());
        if (!Number.isInteger(v) || v < 0) {
          throw new Error(`Invalid --max-revisions: use a non-negative integer.`);
        }
        args.maxRevisions = v;
        break;
      }
      case "--no-captions":
        args.captions = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log("Usage: npm run orchestrate -- --slot <id> [options]");
  console.log("");
  console.log("Runs the full pipeline for ONE plan slot:");
  console.log("  1. Write the script and gate it with the AI reviewer (spends OpenAI tokens).");
  console.log("  2. On PASS, generate the video (spends video credits).");
  console.log("  3. Burn in captions via OpusClip (spends OpusClip credits).");
  console.log("  4. Publish the captioned clip to YouTube as public.");
  console.log("");
  console.log("If the reviewer does NOT PASS, it stops after step 1: no video is generated,");
  console.log("no credits are spent, a report is written, and the command exits non-zero.");
  console.log("");
  console.log("Options:");
  console.log("  --slot <id>            Plan slot id to run (e.g. 2026-09-003)");
  console.log("  --date <YYYY-MM-DD>    Pick the slot by date (errors if the date is ambiguous)");
  console.log("  --provider <name>      wan | seedance | avatar | veo | kling (default from config)");
  console.log("  --ref <path>           Reference image; repeat for multiple (default assets/bix_stand.png)");
  console.log("  --privacy <val>        public | unlisted | private (default public)");
  console.log("  --max-revisions <n>    Override the auto-revision limit");
  console.log("  --no-captions          Skip OpusClip captioning; publish the raw clip");
  console.log("  --help                 Show this help");
  console.log("");
  console.log("Requires OPENAI_API_KEY (script), the video provider's login, and");
  console.log("`npm run youtube -- login` (publish).");
}

/** Phase 1: write + review the slot's script, gated before any credits are spent. */
async function runScriptPhase(
  slotId: string,
  provider: string,
  maxRevisions: number,
  config: ReturnType<typeof loadScriptWriterConfig>,
  sol: UsageTrackingClient,
): Promise<ScriptResult> {
  const writer = new OpenAiScriptWriter({
    client: sol,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    productFacts: config.productFacts,
  });
  const reviewer = new OpenAiScriptReviewer({
    client: sol,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    productFacts: config.productFacts,
  });

  const db = new SqliteDatabase("data/bix.db");
  const reader = new PlanSlotReader(db);
  const assetReader = new AssetReader(db);
  const store = new ScriptStore(db);
  store.init();
  try {
    return await runScriptWriter({
      reader,
      writer,
      reviewer,
      store,
      assetReader,
      maxRevisions,
      provider,
      slotId,
      logger: (message) => console.log(message),
    });
  } finally {
    db.close();
  }
}

/** Resolve the slot id: --slot wins; otherwise --date must match exactly one. */
function resolveSlotId(args: OrchestrateArgs): string {
  if (args.slot) return args.slot;
  if (!args.date) {
    throw new Error("Provide --slot <id> or --date <YYYY-MM-DD> to pick the plan slot.");
  }
  const db = new SqliteDatabase("data/bix.db");
  try {
    const reader = new PlanSlotReader(db);
    const matches = reader.getByDate(args.date);
    if (matches.length === 0) {
      throw new Error(`No plan slot found on ${args.date}. Run the competitor scan first, or check the date.`);
    }
    if (matches.length > 1) {
      const lines = matches.map((m) => `  ${m.id} — ${m.time} ${m.format}: ${m.topic}`).join("\n");
      throw new Error(`More than one slot on ${args.date}; pass --slot to choose one of:\n${lines}`);
    }
    return matches[0].id;
  } finally {
    db.close();
  }
}

function makeProvider(name: ProviderName): VideoProvider {
  switch (name) {
    case "avatar":
      return new FalAvatarSingleTextProvider();
    case "veo":
      return new FalVeo31FastProvider();
    case "kling":
      return new FalKlingV3ProProvider();
    case "seedance":
      return new FalSeedanceProvider();
    default:
      return new HiggsfieldWanProvider();
  }
}

/**
 * Synthesise the images the writer asked for (when the asset library lacked a
 * fit), save each into the Asset library (tagged `generated`, enabled), and
 * return their storage keys so they can feed the video as references.
 *
 * The style anchor is the writer's first chosen asset, else the default stand
 * image, forwarded so the generator keeps Bix consistent. Spends real money, so
 * it is capped at `config.image.maxImages` and only runs in this already-gated
 * generate phase. Every failure is NON-FATAL: it is logged and skipped, and the
 * pipeline continues with whatever refs already exist.
 */
async function realizeNeededImages(
  neededImages: readonly NeededImage[],
  usedAssets: readonly string[],
  config: ReturnType<typeof loadScriptWriterConfig>,
  openaiKey: string,
  fileStorage: LocalFileStorage,
  log: (message: string) => void,
): Promise<string[]> {
  const slice = neededImages.slice(0, config.image.maxImages);
  if (slice.length === 0) return [];

  // Style anchor for subject/style consistency: the writer's first asset, else
  // the default stand image. Missing/unreadable anchor just means no reference.
  const anchorKey = usedAssets[0] ?? DEFAULT_REF;
  let referenceImages: GeneratedImage[] = [];
  try {
    if (fileStorage.exists(anchorKey)) {
      referenceImages = [{ bytes: fileStorage.read(anchorKey), mime: mimeFromKey(anchorKey) }];
    }
  } catch {
    referenceImages = [];
  }

  const generator = new ImageGenerator({
    client: createOpenAiImageGenerator(openaiKey),
    model: config.image.model,
    size: config.image.size,
  });

  const db = new SqliteDatabase("data/bix.db");
  const assetsStore = new AssetsStore(db);
  assetsStore.init();
  const keys: string[] = [];
  try {
    for (const need of slice) {
      try {
        const image = await generator.generate(need, referenceImages);
        const id = randomUUID();
        const storageKey = `assets/uploads/${id}-gen.png`;
        fileStorage.write(storageKey, image.bytes);
        assetsStore.create({
          id,
          storagePath: storageKey,
          filename: `${id}-gen.png`,
          mime: image.mime,
          tags: ["generated"],
          description: need.purpose,
        });
        // The writer's `purpose` doubles as the analysis — no extra vision call.
        assetsStore.updateAnalysis(id, { analysis: need.purpose, status: "done" });
        keys.push(storageKey);
        log(`Generated reference image: ${storageKey} (${need.purpose})`);
      } catch (err) {
        log(
          `Image generation skipped (${need.purpose}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    db.close();
  }
  return keys;
}

/**
 * Captions phase: burn captions onto the generated clip via OpusClip and return
 * the captioned file's storage key. The raw bytes are uploaded directly to
 * OpusClip (the source never needs to be public), and the finished render is
 * saved next to the raw clip as `<name>-captioned.mp4`. If that file already
 * exists (an earlier run reached this step), it is reused rather than
 * re-captioned. Throws on failure so the caller can stop before publishing an
 * uncaptioned clip — the raw video is on disk, so re-running resumes cheaply.
 */
async function captionVideo(
  rawKey: string,
  title: string,
  config: ReturnType<typeof loadScriptWriterConfig>,
  fileStorage: LocalFileStorage,
  log: (message: string) => void,
): Promise<string> {
  const captionedKey = rawKey.endsWith(".mp4")
    ? `${rawKey.slice(0, -4)}-captioned.mp4`
    : `${rawKey}-captioned.mp4`;
  if (fileStorage.exists(captionedKey)) {
    log(`Reusing the captioned render from an earlier run: ${captionedKey}`);
    return captionedKey;
  }
  const apiKey = requireKey("CAPTIONS");
  const captioner = new OpusClipCaptioner({ apiKey, logger: log });
  const rawBytes = fileStorage.read(rawKey);
  const captioned = await captioner.caption(rawBytes, {
    layoutAspectRatio: aspectRatioToLayout(config.video.aspectRatio),
    sourceLang: config.captions.sourceLang,
    brandTemplateId: config.captions.brandTemplateId,
    title,
  });
  fileStorage.write(captionedKey, captioned);
  return captionedKey;
}

export async function runOrchestrate(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  let args: OrchestrateArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    printUsage();
    return 1;
  }

  loadEnv();

  let openaiKey: string;
  try {
    openaiKey = requireKey("OPENAI_API_KEY");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("The orchestrator needs OPENAI_API_KEY (the writer and reviewer both use GPT-5.6 Sol).");
    return 1;
  }

  const configDir = resolve(process.cwd(), "config");
  const config = loadScriptWriterConfig(configDir);
  const providerName = (args.provider ?? config.video.provider) as ProviderName;
  const maxRevisions = args.maxRevisions ?? config.maxRevisions;

  let slotId: string;
  try {
    slotId = resolveSlotId(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const fileStorage = new LocalFileStorage(process.cwd());
  const sol = new UsageTrackingClient(createSolClient(openaiKey));

  // ---- Phase 1: script + review gate --------------------------------------
  let result: ScriptResult;
  try {
    result = await runScriptPhase(slotId, providerName, maxRevisions, config, sol);
  } catch (err) {
    console.error("");
    console.error(`Script phase failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const reportPath = `outputs/scripts/script-${result.slotId}.md`;
  fileStorage.write(reportPath, renderScriptReport(result));

  console.log("");
  console.log(`Reviewer decision: ${result.review.decision} (after ${result.revisions} revision(s)).`);
  console.log(`Report: ${fileStorage.localPath(reportPath)}`);

  const cost = computeCost(sol.totals(), config.pricing);
  console.log("");
  console.log("Script cost (OpenAI, actual usage):");
  console.log(`  Calls:  ${cost.calls}`);
  if (cost.inputTokens === 0 && cost.outputTokens === 0) {
    console.log("  Token usage was not reported by the API, so no dollar cost can be shown.");
  } else {
    console.log(`  Input:  ${cost.inputTokens.toLocaleString()} tokens = $${cost.inputCost.toFixed(4)}`);
    console.log(`  Output: ${cost.outputTokens.toLocaleString()} tokens = $${cost.outputCost.toFixed(4)}`);
    console.log(`  Token cost total: $${cost.total.toFixed(4)}`);
  }

  if (result.review.decision !== "PASS") {
    console.log("");
    console.log("Not ready: the reviewer did not PASS, so the pipeline stops here.");
    console.log("No video was generated and no credits were spent. Review the report's issues,");
    console.log("adjust the plan slot or config/script-writer.json, and re-run.");
    return 1;
  }

  // Keep the generation-ready prompt on disk for reruns / inspection.
  const promptPath = `outputs/scripts/prompt-${result.slotId}.md`;
  fileStorage.write(promptPath, result.videoPrompt);
  console.log(`Prompt: ${fileStorage.localPath(promptPath)}`);

  // Realize any images the writer asked for (library had no fit), saving them to
  // the Asset library and reusing them as references. Non-fatal: on failure we
  // fall back to whatever refs already exist. Skipped when --ref is explicit.
  let generatedKeys: string[] = [];
  if (args.refs.length === 0 && result.draft.neededImages.length > 0) {
    console.log("");
    console.log(
      `Generating ${result.draft.neededImages.length} writer-requested image(s) (spends credits)...`,
    );
    generatedKeys = await realizeNeededImages(
      result.draft.neededImages,
      result.draft.usedAssets,
      config,
      openaiKey,
      fileStorage,
      (message) => console.log(message),
    );
  }

  // Resolve references now that the script exists: an explicit --ref wins;
  // otherwise the assets the writer chose plus any generated ones; else the default.
  const effectiveRefs = selectRefs(args.refs, result.draft.usedAssets, generatedKeys);

  for (const ref of effectiveRefs) {
    if (!existsSync(ref)) {
      console.error(`Reference image not found: ${ref}`);
      return 1;
    }
  }
  if (args.refs.length === 0 && effectiveRefs[0] !== DEFAULT_REF) {
    console.log(`Reference assets: ${effectiveRefs.join(", ")}`);
  }

  // Prefer a freshly generated still for the custom YouTube thumbnail.
  const thumbnailKey = pickThumbnailKey(generatedKeys, effectiveRefs);

  // ---- Phase 2: generate the video ----------------------------------------
  console.log("");
  console.log(`PASS — generating the video with the "${providerName}" provider (spends credits)...`);
  const provider = makeProvider(providerName);
  const db = new SqliteDatabase("data/bix.db");
  const videoStore = new VideoJobStore(db);
  const runner = new VideoRunner({ provider, store: videoStore, fileStorage });

  const request: VideoRequest = {
    prompt: result.videoPrompt,
    refImagePaths: effectiveRefs,
    resolution: config.video.resolution,
    aspectRatio: config.video.aspectRatio,
    duration: result.draft.durationSeconds || config.video.durationSeconds,
    generateAudio: config.video.generateAudio,
    label: `orchestrate-${result.slotId}`,
  };

  let outputPath: string;
  try {
    const gen = await runner.generate(request);
    outputPath = gen.outputPath;
    console.log("");
    console.log(gen.resumed ? "Resumed an existing job." : "Completed a new job.");
    console.log(`Video:      ${fileStorage.localPath(gen.outputPath)}`);
  } catch (err) {
    console.error("");
    console.error(`Video generation failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Rerun the same command to resume the saved request.");
    return 1;
  } finally {
    db.close();
  }

  // ---- Phase 3: burn in captions (OpusClip) -------------------------------
  let publishKey = outputPath;
  if (args.captions && config.captions.enabled) {
    console.log("");
    console.log("Adding captions with OpusClip (spends OpusClip credits)...");
    try {
      publishKey = await captionVideo(
        outputPath,
        `Bix — ${result.slotId} (captioned)`,
        config,
        fileStorage,
        (message) => console.log(message),
      );
      console.log(`Captioned:  ${fileStorage.localPath(publishKey)}`);
    } catch (err) {
      console.error("");
      console.error(`Captioning failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("The raw video is saved; re-run the same command to retry captioning,");
      console.error("or pass --no-captions to publish the uncaptioned clip.");
      return 1;
    }
  } else {
    console.log("");
    console.log("Captions disabled — publishing the raw clip.");
  }

  // ---- Phase 4: publish to YouTube ----------------------------------------
  try {
    console.log("");
    const outcome = await publishFile({
      storageKey: publishKey,
      slotId: result.slotId,
      privacy: args.privacy,
      syntheticDisclosure: true,
      thumbnailKey,
    });
    console.log(outcome.skipped ? "Already published (no duplicate created)." : "Published.");
    console.log(`YouTube:    ${outcome.url}`);
    console.log("");
    console.log(
      args.privacy === "public"
        ? "Done. The clip is live (public) on YouTube."
        : `Done. The clip is ${args.privacy} — flip it with: npm run youtube -- update --slot ${result.slotId} --privacy public`,
    );
    return 0;
  } catch (err) {
    console.error("");
    console.error(
      `The video was generated but publishing failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(`Retry with: npm run youtube -- upload --file ${publishKey} --slot ${result.slotId} --privacy ${args.privacy}`);
    return 1;
  }
}
