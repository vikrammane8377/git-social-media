import { resolve } from "node:path";
import { loadEnv, requireKey } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  OpenAiEventSearch,
  OpenAiTopicScorer,
  NagerHolidayClient,
  EventIdeaStore,
  createOpenAiClient,
  loadScanConfig,
  loadCuratedCalendar,
  calendarTopics,
  renderReport,
  runScan,
} from "@bix/events";

function printScanUsage(): void {
  console.log("Usage: npm run scan:events");
  console.log("");
  console.log("Scans upcoming, on-brand events for the next few weeks and writes a report.");
  console.log("Sources: OpenAI web search + public-holiday API + config/curated-calendar.json.");
  console.log("Requires OPENAI_API_KEY in .env. Settings live in config/events-scan.json.");
}

export async function runEventsScan(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printScanUsage();
    return 0;
  }

  loadEnv();

  let apiKey: string;
  try {
    apiKey = requireKey("OPENAI_API_KEY");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("Component 2 needs OPENAI_API_KEY (used for web search and scoring).");
    return 1;
  }

  const configDir = resolve(process.cwd(), "config");
  const config = loadScanConfig(configDir);
  const calendar = calendarTopics(loadCuratedCalendar(configDir));

  const client = createOpenAiClient(apiKey);
  const search = new OpenAiEventSearch({ client, model: config.model });
  const scorer = new OpenAiTopicScorer({ client, model: config.model });
  const holidays = new NagerHolidayClient({ baseUrl: config.holidayApiBaseUrl });

  const db = new SqliteDatabase("data/bix.db");
  const store = new EventIdeaStore(db);
  store.init();

  try {
    const result = await runScan({
      search,
      holidays,
      scorer,
      calendar,
      holidayCountries: config.holidayCountries,
      searchCountries: config.searchCountries,
      weeksAhead: config.weeksAhead,
      blocklistKeywords: config.blocklistKeywords,
      logger: (message) => console.log(message),
    });

    store.saveKept(result.date, result.kept);

    const fileStorage = new LocalFileStorage(process.cwd());
    const reportPath = `outputs/scans/events-${result.date}.md`;
    fileStorage.write(reportPath, renderReport(result));

    console.log("");
    console.log(`Kept ${result.kept.length} idea(s), blocked ${result.blocked.length}.`);
    console.log(`Saved ideas to SQLite and wrote ${fileStorage.localPath(reportPath)}`);
    return 0;
  } catch (err) {
    console.error("");
    console.error(`Events scan failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    db.close();
  }
}
