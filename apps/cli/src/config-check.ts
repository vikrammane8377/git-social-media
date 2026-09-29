import { loadEnv, checkKeys, type KeyStatus } from "@bix/config";

/**
 * Print a present/missing report for every known key. The underlying values are
 * never read into the report, printed or logged.
 */
export function runConfigCheck(): number {
  loadEnv();
  const statuses = checkKeys();

  const nameWidth = Math.max(...statuses.map((s) => s.name.length), 4);

  console.log("Bix config check");
  console.log("Reports each key as present/missing. Values are never shown.\n");

  for (const s of statuses) {
    const mark = s.present ? "present" : "MISSING";
    console.log(`  [${mark}] ${s.name.padEnd(nameWidth)}  - ${s.component}`);
  }

  const missing = statuses.filter((s: KeyStatus) => !s.present);
  console.log("");
  if (missing.length === 0) {
    console.log(`All ${statuses.length} known keys are present.`);
  } else {
    console.log(
      `${missing.length} of ${statuses.length} keys missing: ${missing
        .map((s) => s.name)
        .join(", ")}`,
    );
    console.log("Add them to .env (see .env.example). This is expected until you reach that component.");
  }

  // A missing key is informational, not a failure at this stage, so exit 0.
  return 0;
}
