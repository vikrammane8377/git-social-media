import { resolve } from "node:path";
import { loadEnv, requireKey } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  YouTubeDataClient,
  OpenAiCompetitorAnalyst,
  OpenAiPlanGenerator,
  LatestEventsReader,
  ContentPlanStore,
  UsageTrackingClient,
  computeCost,
  createAstraClient,
  loadCompetitorConfig,
  renderPlanReport,
  renderPlanJson,
  runCompetitorScan,
} from "@bix/competitors";

function printUsage(): void {
  console.log("Usage: npm run scan:competitors");
  console.log("");
  console.log("Scans tracked competitor YouTube Shorts, learns formats/trends, and");
  console.log("builds a 30-day content plan combining competitor insights, the latest");
  console.log("events scan, evergreen formats and the configured cadence.");
  console.log("Requires OPENAI_API_KEY and YOUTUBE_API_KEY in .env.");
  console.log("Settings live in config/competitor-scan.json.");
}

export async function runCompetitorsScan(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  loadEnv();

  let openaiKey: string;
  let youtubeKey: string;
  try {
    openaiKey = requireKey("OPENAI_API_KEY");
    youtubeKey = requireKey("YOUTUBE_API_KEY");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("Component 3 needs OPENAI_API_KEY (analysis + planning) and YOUTUBE_API_KEY (public YouTube data).");
    return 1;
  }

  const configDir = resolve(process.cwd(), "config");
  const config = loadCompetitorConfig(configDir);

  // Wrap the real client so we can report exactly how many tokens this run used.
  const astra = new UsageTrackingClient(createAstraClient(openaiKey));
  const youtube = new YouTubeDataClient({
    apiKey: youtubeKey,
    fetch: (url) => fetch(url),
    baseUrl: config.youtubeApiBaseUrl,
  });
  const analyst = new OpenAiCompetitorAnalyst({
    client: astra,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
  });
  const planner = new OpenAiPlanGenerator({
    client: astra,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    evergreenFormats: config.evergreenFormats,
  });

  const db = new SqliteDatabase("data/bix.db");
  const events = new LatestEventsReader(db);
  const store = new ContentPlanStore(db);
  store.init();

  console.log("Note: competitor channel handles in config/competitor-scan.json are");
  console.log("unconfirmed placeholders — confirm the real channel IDs before relying on a run.");

  try {
    const result = await runCompetitorScan({
      youtube,
      analyst,
      planner,
      events,
      channels: config.channels,
      maxVideosPerChannel: config.maxVideosPerChannel,
      maxShortSeconds: config.maxShortSeconds,
      planDays: config.planDays,
      cadence: config.cadence,
      logger: (message) => console.log(message),
    });

    store.save(result.plan);

    const fileStorage = new LocalFileStorage(process.cwd());
    const mdPath = `outputs/plans/plan-${result.plan.month}.md`;
    const jsonPath = `outputs/plans/plan-${result.plan.month}.json`;
    fileStorage.write(mdPath, renderPlanReport(result));
    fileStorage.write(jsonPath, renderPlanJson(result));

    console.log("");
    console.log(
      `Analysed ${result.videos.length} Short(s) across ${result.channels.length} channel(s); ` +
        `built a ${result.plan.slots.length}-slot plan.`,
    );
    if (result.unresolved.length > 0) {
      console.log(`Unresolved channels: ${result.unresolved.map((u) => u.channel.name).join(", ")}`);
    }
    console.log(`Saved the plan to SQLite and wrote:`);
    console.log(`  ${fileStorage.localPath(mdPath)}`);
    console.log(`  ${fileStorage.localPath(jsonPath)}`);

    const cost = computeCost(astra.totals(), config.pricing);
    console.log("");
    console.log("Cost of this run (OpenAI, actual usage):");
    console.log(`  Model:  ${config.model} @ $${config.pricing.inputPerMillion}/1M in, $${config.pricing.outputPerMillion}/1M out`);
    console.log(`  Calls:  ${cost.calls} (web search on ${cost.webSearchCalls})`);
    if (cost.inputTokens === 0 && cost.outputTokens === 0) {
      console.log("  Token usage was not reported by the API, so no dollar cost can be shown.");
      console.log("  Check your OpenAI usage dashboard for the exact amount.");
    } else {
      console.log(`  Input:  ${cost.inputTokens.toLocaleString()} tokens = $${cost.inputCost.toFixed(4)}`);
      console.log(`  Output: ${cost.outputTokens.toLocaleString()} tokens = $${cost.outputCost.toFixed(4)}`);
      console.log(`  Token cost total: $${cost.total.toFixed(4)}`);
    }
    if (cost.webSearchCalls > 0) {
      console.log("  Plus a web-search per-call fee (billed separately by OpenAI, not included above).");
    }
    console.log("  YouTube Data API reads are free within the daily quota.");
    return 0;
  } catch (err) {
    console.error("");
    console.error(`Competitor scan failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    db.close();
  }
}
