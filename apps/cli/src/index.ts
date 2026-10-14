#!/usr/bin/env node
import { runConfigCheck } from "./config-check.js";
import { runVideo } from "./video.js";
import { runEventsScan } from "./events.js";
import { runCompetitorsScan } from "./competitors.js";
import { runHiggsfield } from "./higgsfield.js";
import { runYoutube } from "./youtube.js";
import { runScript } from "./script.js";
import { runOrchestrate } from "./orchestrate.js";
import { runPlanFeatures } from "./plan-features.js";
import { runRunDaily } from "./run-daily.js";

async function main(argv: string[]): Promise<number> {
  const command = argv[2];
  const rest = argv.slice(3);

  switch (command) {
    case "check":
    case "config:check":
      return runConfigCheck();
    case "video":
      return runVideo(rest);
    case "scan:events":
      return runEventsScan(rest);
    case "scan:competitors":
      return runCompetitorsScan(rest);
    case "higgsfield":
      return runHiggsfield(rest);
    case "youtube":
      return runYoutube(rest);
    case "script":
      return runScript(rest);
    case "orchestrate":
      return runOrchestrate(rest);
    case "plan:features":
      return runPlanFeatures(rest);
    case "run-daily":
      return runRunDaily(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      return 1;
  }
}

function printUsage(): void {
  console.log("Bix Social Console CLI");
  console.log("");
  console.log("Usage: bix <command>");
  console.log("");
  console.log("Commands:");
  console.log("  check    Report each .env key as present/missing (values never shown)");
  console.log("  video        Generate a video clip from a prompt file and reference image(s)");
  console.log("  scan:events  Scan upcoming on-brand events and write a report");
  console.log("  scan:competitors  Scan competitor Shorts and build a 30-day content plan");
  console.log("  higgsfield   Sign in to Higgsfield MCP and generate via subscription (login|status|tools)");
  console.log("  youtube      Sign in to YouTube and publish a generated video (login|status|upload)");
  console.log("  script       Write a script from a plan slot and gate it with the AI reviewer");
  console.log("  orchestrate  Run one slot end-to-end: script+review -> generate -> publish (unlisted)");
  console.log("  plan:features  Enumerate one feature-demo slot per app screenshot per channel");
  console.log("  run-daily    Run the day's scheduled slot(s) by source (event/competitor) for cron");
  console.log("  help         Show this help");
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
