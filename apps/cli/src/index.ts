#!/usr/bin/env node
import { runConfigCheck } from "./config-check.js";
import { runVideo } from "./video.js";

async function main(argv: string[]): Promise<number> {
  const command = argv[2];
  const rest = argv.slice(3);

  switch (command) {
    case "check":
    case "config:check":
      return runConfigCheck();
    case "video":
      return runVideo(rest);
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
  console.log("  video    Generate a video clip from a prompt file and reference image(s)");
  console.log("  help     Show this help");
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
