import type { CompetitorScanResult } from "./types.js";

function sourceLabel(source: string): string {
  switch (source) {
    case "event":
      return "event";
    case "competitor":
      return "competitor insight";
    case "evergreen":
      return "evergreen";
    default:
      return source;
  }
}

function bullets(label: string, items: string[]): string[] {
  if (items.length === 0) return [`- **${label}:** _none_`];
  return [`- **${label}:** ${items.join("; ")}`];
}

/**
 * Render the scan as a readable Markdown report: what was collected, the learned
 * competitor insights (with the reach caveat), then the content plan grouped by
 * date. Written to outputs/plans/plan-YYYY-MM.md by the CLI.
 */
export function renderPlanReport(result: CompetitorScanResult): string {
  const { insights, plan } = result;
  const lines: string[] = [];

  lines.push(`# Content plan — ${plan.month}`);
  lines.push("");
  lines.push(`Generated ${result.date} · ${plan.startDate} → ${plan.endDate} · times in ${plan.timezone}`);
  lines.push("");

  lines.push("## Competitors scanned");
  lines.push("");
  if (result.channels.length === 0) {
    lines.push("_No channels resolved._");
  } else {
    for (const c of result.channels) {
      const count = result.videos.filter((v) => v.channelId === c.channelId).length;
      const subs = c.subscriberCount !== undefined ? ` · ${c.subscriberCount} subs` : "";
      lines.push(`- **${c.title}**${subs} — ${count} recent Short(s) analysed`);
    }
  }
  if (result.unresolved.length > 0) {
    lines.push("");
    lines.push("Unresolved channels:");
    for (const u of result.unresolved) {
      lines.push(`- ${u.channel.name}: ${u.reason}`);
    }
  }
  lines.push("");
  lines.push("_Public counts cannot distinguish organic vs paid reach or audience nationality._");
  lines.push("");

  lines.push("## Learned patterns (formats/trends only)");
  lines.push("");
  lines.push(...bullets("Formats", insights.formats));
  lines.push(...bullets("Hooks", insights.hooks));
  lines.push(`- **Lengths:** ${insights.lengths || "_n/a_"}`);
  lines.push(`- **Posting rhythm:** ${insights.postingRhythm || "_n/a_"}`);
  lines.push(...bullets("Themes", insights.themes));
  lines.push(...bullets("CTAs", insights.ctas));
  if (insights.notes.length > 0) {
    lines.push(...bullets("Notes", insights.notes));
  }
  lines.push("");

  const byEvent = plan.slots.filter((s) => s.source === "event").length;
  const byComp = plan.slots.length - byEvent;
  lines.push(`## Plan (${plan.slots.length} slot(s): ${byEvent} event, ${byComp} competitor)`);
  lines.push("");
  if (plan.slots.length === 0) {
    lines.push("_No slots were produced._");
  } else {
    for (const s of plan.slots) {
      lines.push(`### ${s.date} ${s.time} — ${s.format}  \`${s.brandFit}/10\``);
      lines.push("");
      lines.push(`- **Source:** ${sourceLabel(s.source)}`);
      lines.push(`- **Topic:** ${s.topic}`);
      if (s.hook) lines.push(`- **Hook:** ${s.hook}`);
      if (s.why) lines.push(`- **Why:** ${s.why}`);
      if (s.assets.length > 0) lines.push(`- **Assets:** ${s.assets.join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** The JSON version of the plan written alongside the Markdown report. */
export function renderPlanJson(result: CompetitorScanResult): string {
  return JSON.stringify(
    {
      generatedAt: result.date,
      plan: result.plan,
      insights: result.insights,
      channels: result.channels,
      unresolved: result.unresolved,
      videoCount: result.videos.length,
    },
    null,
    2,
  );
}
