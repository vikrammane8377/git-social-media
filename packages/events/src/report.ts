import type { ScanResult } from "./types.js";

/** A single source label for the report. */
function sourceLabel(source: string): string {
  switch (source) {
    case "web":
      return "web search";
    case "holiday":
      return "holiday API";
    case "calendar":
      return "curated calendar";
    default:
      return source;
  }
}

/**
 * Render a scan as a readable Markdown report: kept ideas (highest brand fit
 * first) with their details, then blocked topics with the reason each was
 * removed. Written to outputs/scans/events-YYYY-MM-DD.md by the CLI.
 */
export function renderReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# Events scan — ${result.date}`);
  lines.push("");
  lines.push(`Kept: ${result.kept.length} · Blocked: ${result.blocked.length}`);
  lines.push("");

  lines.push("## Kept ideas");
  lines.push("");
  if (result.kept.length === 0) {
    lines.push("_None._");
  } else {
    const sorted = [...result.kept].sort((a, b) => b.score.brandFit - a.score.brandFit);
    for (const t of sorted) {
      const range = t.endDate ? `${t.date} → ${t.endDate}` : t.date;
      lines.push(`### ${t.title}  \`${t.score.brandFit}/10\``);
      lines.push("");
      lines.push(`- **Date:** ${range}${t.country ? ` · ${t.country}` : ""}`);
      lines.push(`- **Source:** ${sourceLabel(t.source)} — ${t.sourceUrl}`);
      if (t.score.reason) lines.push(`- **Why:** ${t.score.reason}`);
      if (t.score.suggestedFormat) lines.push(`- **Format:** ${t.score.suggestedFormat}`);
      lines.push(`- **Posting window:** ${t.score.postingWindow.earliest} → ${t.score.postingWindow.latest}`);
      if (t.summary) lines.push(`- **Summary:** ${t.summary}`);
      lines.push("");
    }
  }

  lines.push("## Blocked topics");
  lines.push("");
  if (result.blocked.length === 0) {
    lines.push("_None._");
  } else {
    for (const b of result.blocked) {
      lines.push(`- **${b.topic.title}** (${b.topic.date}) — blocked ${b.stage}-scoring: ${b.reason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
