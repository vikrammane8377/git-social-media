import type { ScriptResult } from "./types.js";

function bulletList(label: string, items: string[]): string[] {
  if (items.length === 0) return [`- **${label}:** _none_`];
  return [`- **${label}:**`, ...items.map((i) => `  - ${i}`)];
}

/**
 * Render a script-writer run as a readable Markdown report: the slot context,
 * the final script, the reviewer's decision and revision count, and the
 * reviewer's issues/claims/coverage/uncertainty. Written to
 * outputs/scripts/script-<slotId>.md by the CLI.
 */
export function renderScriptReport(result: ScriptResult): string {
  const { draft, review } = result;
  const lines: string[] = [];

  lines.push(`# Script — slot ${result.slotId}`);
  lines.push("");
  const ready = review.decision === "PASS";
  lines.push(`Decision: **${review.decision}** · revisions: ${result.revisions} · ${ready ? "ready to generate" : "not ready (no video yet)"}`);
  lines.push("");

  lines.push("## Script");
  lines.push("");
  if (draft.title) lines.push(`**Title:** ${draft.title}`);
  lines.push(`**Duration:** ${draft.durationSeconds}s`);
  lines.push("");
  lines.push("**Scene:**");
  lines.push("");
  lines.push(draft.scenePrompt || "_(empty)_");
  lines.push("");
  lines.push("**Dialogue:**");
  lines.push("");
  lines.push(draft.dialogue || "_(empty)_");
  if (draft.notes) {
    lines.push("");
    lines.push(`**Notes:** ${draft.notes}`);
  }
  lines.push("");

  lines.push("## Reviewer verdict");
  lines.push("");
  lines.push(`- **Decision:** ${review.decision}`);
  lines.push(`- **English meaning:** ${review.englishMeaning || "_n/a_"}`);
  lines.push(`- **Brand voice:** ${review.brandVoice || "_n/a_"}`);
  lines.push(...bulletList("Issues", review.issues));
  lines.push(...bulletList("Product claims", review.productClaims));
  lines.push(`- **Coverage:** ${review.coverage || "_n/a_"}`);
  lines.push(`- **Uncertainty:** ${review.uncertainty || "_none_"}`);
  lines.push(`- **Next step:** ${review.nextStep || "_n/a_"}`);
  lines.push("");
  lines.push("_AI review never grants permission to publish or spend. The owner is the sole approver._");
  lines.push("");

  lines.push("## Generation-ready prompt");
  lines.push("");
  if (ready) {
    lines.push("```");
    lines.push(result.videoPrompt);
    lines.push("```");
  } else {
    lines.push("_Not written: the reviewer did not PASS this draft, so no prompt file was emitted._");
  }
  lines.push("");

  return lines.join("\n");
}
