import { resolve } from "node:path";
import { loadEnv, requireKey, getChannel, isChannelId } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  PlanSlotReader,
  AssetReader,
  ScriptStore,
  OpenAiScriptWriter,
  OpenAiScriptReviewer,
  UsageTrackingClient,
  computeCost,
  createSolClient,
  loadScriptWriterConfig,
  renderScriptReport,
  runScriptWriter,
} from "@bix/scripts";

interface ScriptArgs {
  slot?: string;
  date?: string;
  provider?: string;
  maxRevisions?: number;
}

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {};
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
        if (v !== "wan" && v !== "avatar" && v !== "veo" && v !== "kling" && v !== "seedance") {
          throw new Error(`Invalid --provider: ${v} (use wan, avatar, veo, kling or seedance).`);
        }
        args.provider = v;
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
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log("Usage: npm run script -- --slot <id> [options]");
  console.log("");
  console.log("Turns a stored content-plan slot into a spoken script and a");
  console.log("generation-ready video prompt, gated by the AI language reviewer");
  console.log("(PASS / REVISE / NEEDS_EVIDENCE) BEFORE any video is generated.");
  console.log("On REVISE it auto-revises up to the configured limit, then stops.");
  console.log("");
  console.log("Options:");
  console.log("  --slot <id>            Plan slot id to script (e.g. 2026-09-003)");
  console.log("  --date <YYYY-MM-DD>    Pick the slot by date (errors if the date is ambiguous)");
  console.log("  --provider <name>      wan | avatar | veo | kling | seedance (default from config)");
  console.log("  --max-revisions <n>    Override the auto-revision limit");
  console.log("  --help                 Show this help");
  console.log("");
  console.log("Spends OpenAI tokens ONLY — it never calls a video provider, so it");
  console.log("cannot burn video credits. Requires OPENAI_API_KEY in .env.");
  console.log("Settings live in config/script-writer.json.");
}

export async function runScript(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  let args: ScriptArgs;
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
    console.error("Component 4 needs OPENAI_API_KEY (the writer and reviewer both use GPT-5.6 Sol).");
    return 1;
  }

  const configDir = resolve(process.cwd(), "config");
  const config = loadScriptWriterConfig(configDir);
  const provider = args.provider ?? config.video.provider;
  const maxRevisions = args.maxRevisions ?? config.maxRevisions;

  // Wrap the real client so we can report exactly how many tokens this run used.
  const sol = new UsageTrackingClient(createSolClient(openaiKey));

  const db = new SqliteDatabase("data/bix.db");
  const reader = new PlanSlotReader(db);
  const assetReader = new AssetReader(db);
  const store = new ScriptStore(db);
  store.init();

  try {
    // Resolve the slot id: --slot wins; otherwise --date must match exactly one.
    let slotId = args.slot;
    if (!slotId) {
      if (!args.date) {
        console.error("Provide --slot <id> or --date <YYYY-MM-DD> to pick the plan slot.\n");
        printUsage();
        return 1;
      }
      const matches = reader.getByDate(args.date);
      if (matches.length === 0) {
        console.error(`No plan slot found on ${args.date}. Run the competitor scan first, or check the date.`);
        return 1;
      }
      if (matches.length > 1) {
        console.error(`More than one slot on ${args.date}; pass --slot to choose one of:`);
        for (const m of matches) console.error(`  ${m.id} — ${m.time} ${m.format}: ${m.topic}`);
        return 1;
      }
      slotId = matches[0].id;
    }

    // The slot's channel drives the writer/reviewer persona (Spanish vs. global
    // English); older rows read back as "spanish".
    const slotRecord = reader.getById(slotId);
    const channelId = slotRecord && isChannelId(slotRecord.channel) ? slotRecord.channel : "spanish";
    const channel = getChannel(channelId, configDir);
    console.log(`Channel: ${channel.label} (${channel.id})`);

    const writer = new OpenAiScriptWriter({
      client: sol,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      writerPersona: channel.writerPersona,
      productFacts: channel.productFacts,
      outroCta: channel.outroCta,
    });
    const reviewer = new OpenAiScriptReviewer({
      client: sol,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      channelBrief: channel.writerPersona,
      primaryLanguage: channel.primaryLanguage,
      productFacts: channel.productFacts,
    });

    const result = await runScriptWriter({
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

    const fileStorage = new LocalFileStorage(process.cwd());
    const reportPath = `outputs/scripts/script-${result.slotId}.md`;
    fileStorage.write(reportPath, renderScriptReport(result));

    console.log("");
    console.log(`Reviewer decision: ${result.review.decision} (after ${result.revisions} revision(s)).`);
    console.log(`Report: ${fileStorage.localPath(reportPath)}`);

    const passed = result.review.decision === "PASS";
    if (passed) {
      const promptPath = `outputs/scripts/prompt-${result.slotId}.md`;
      fileStorage.write(promptPath, result.videoPrompt);
      // Use the writer's chosen reference assets (multi-image) when it picked any;
      // otherwise fall back to the default stand image.
      const refs =
        result.draft.usedAssets.length > 0
          ? result.draft.usedAssets
          : ["assets/bix_stand.png"];
      const refFlags = refs.map((r) => `--ref ${r}`).join(" ");
      console.log(`Prompt: ${fileStorage.localPath(promptPath)}`);
      if (result.draft.usedAssets.length > 0) {
        console.log(`Chosen reference assets: ${result.draft.usedAssets.join(", ")}`);
      }
      console.log("");
      console.log("PASS — ready to generate. Run next (spends video credits):");
      console.log(
        `  npm run video -- --provider ${provider} --prompt-file ${promptPath} ${refFlags} ` +
          `--resolution ${config.video.resolution} --aspect-ratio ${config.video.aspectRatio} ` +
          `--duration ${result.draft.durationSeconds || config.video.durationSeconds}`,
      );
    } else {
      console.log("");
      console.log("Not ready: the reviewer did not PASS, so no prompt file was emitted and no");
      console.log("video should be generated. See the report's issues, adjust the plan slot or");
      console.log("config/script-writer.json, and re-run.");
    }

    const cost = computeCost(sol.totals(), config.pricing);
    console.log("");
    console.log("Cost of this run (OpenAI, actual usage):");
    console.log(`  Model:  ${config.model} @ $${config.pricing.inputPerMillion}/1M in, $${config.pricing.outputPerMillion}/1M out (placeholder price)`);
    console.log(`  Calls:  ${cost.calls}`);
    if (cost.inputTokens === 0 && cost.outputTokens === 0) {
      console.log("  Token usage was not reported by the API, so no dollar cost can be shown.");
      console.log("  Check your OpenAI usage dashboard for the exact amount.");
    } else {
      console.log(`  Input:  ${cost.inputTokens.toLocaleString()} tokens = $${cost.inputCost.toFixed(4)}`);
      console.log(`  Output: ${cost.outputTokens.toLocaleString()} tokens = $${cost.outputCost.toFixed(4)}`);
      console.log(`  Token cost total: $${cost.total.toFixed(4)}`);
    }
    console.log("  No video credits were spent — this component gates generation, it never runs it.");

    return passed ? 0 : 1;
  } catch (err) {
    console.error("");
    console.error(`Script writer failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    db.close();
  }
}
