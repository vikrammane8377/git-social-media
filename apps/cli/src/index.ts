#!/usr/bin/env node
import { runConfigCheck } from "./config-check.js";

function main(argv: string[]): number {
  const command = argv[2];

  switch (command) {
    case "check":
    case "config:check":
      return runConfigCheck();
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
  console.log("  help     Show this help");
}

process.exit(main(process.argv));
