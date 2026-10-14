import { relative, resolve } from "node:path";
import { enabledChannels } from "@bix/config";
import { SqliteDatabase } from "@bix/storage";
import { ContentPlanStore, buildFeatureSlots, insertFeatureSlots } from "@bix/competitors";
import { loadBrandAssets } from "@bix/brand";

function printUsage(): void {
  console.log("Usage: npm run plan:features");
  console.log("");
  console.log("Enumerates one 'feature demo' slot per app-UI screenshot under");
  console.log("assets/brand/screenshots/ for each enabled channel, deriving the topic");
  console.log("from the filename. The store-badge PNGs are excluded automatically.");
  console.log("Feature slots are inserted directly (ids feature-<channel>-<NN>) and never");
  console.log("overwrite the competitor/event scan's dated slots.");
}

export async function runPlanFeatures(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  const root = process.cwd();
  const configDir = resolve(root, "config");
  const channels = enabledChannels(configDir);
  if (channels.length === 0) {
    console.error("No enabled channels in config/channels.json — nothing to plan.");
    return 1;
  }

  const assets = loadBrandAssets(root);
  if (assets.screenshots.length === 0) {
    console.error("No app-UI screenshots found under assets/brand/screenshots/ — nothing to plan.");
    return 1;
  }

  // Store repo-relative paths so the slot rows are portable across machines; the
  // orchestrator resolves them against the repo root when it reads the screenshot.
  const screenshots = assets.screenshots.map((abs) => relative(root, abs));
  const slots = buildFeatureSlots(screenshots, channels);

  const db = new SqliteDatabase("data/bix.db");
  const store = new ContentPlanStore(db);
  store.init();
  try {
    const ids = insertFeatureSlots(db, slots);
    console.log(
      `Inserted ${ids.length} feature slot(s) from ${screenshots.length} screenshot(s) ` +
        `across ${channels.length} channel(s):`,
    );
    for (const id of ids) console.log(`  ${id}`);
    return 0;
  } catch (err) {
    console.error(`plan:features failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    db.close();
  }
}
