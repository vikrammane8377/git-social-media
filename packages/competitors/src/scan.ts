import type { YouTubeClient } from "./youtube.js";
import type { OpenAiCompetitorAnalyst } from "./insights.js";
import type { OpenAiPlanGenerator, Cadence } from "./plan.js";
import type { EventIdea } from "./events-source.js";
import type { ChannelConfig, CompetitorScanResult, CompetitorVideo, ResolvedChannel } from "./types.js";
import { toIsoDate } from "./dates.js";

/** Anything that can supply the latest kept event ideas (real or mocked). */
export interface EventsReader {
  read(fromDate: string): EventIdea[];
}

/** The analyst/planner as narrow interfaces, so tests can mock them. */
export type Analyst = Pick<OpenAiCompetitorAnalyst, "summarise">;
export type Planner = Pick<OpenAiPlanGenerator, "generate">;

export interface CompetitorScanDeps {
  youtube: YouTubeClient;
  analyst: Analyst;
  planner: Planner;
  events: EventsReader;
  channels: readonly ChannelConfig[];
  maxVideosPerChannel: number;
  maxShortSeconds: number;
  planDays: number;
  cadence: Cadence;
  today?: Date;
  logger?: (message: string) => void;
}

/**
 * Run one competitor scan end to end:
 *   resolve channels -> pull recent Shorts -> summarise patterns
 *   -> read latest events -> generate the 30-day plan.
 * A channel that fails to resolve is recorded in `unresolved` and skipped; the
 * scan does not fail as a whole. Pure with respect to storage: returns the
 * result; the CLI persists it and writes the report.
 */
export async function runCompetitorScan(deps: CompetitorScanDeps): Promise<CompetitorScanResult> {
  const log = deps.logger ?? (() => {});
  const now = deps.today ?? new Date();
  const scanDate = toIsoDate(now);

  const channels: ResolvedChannel[] = [];
  const videos: CompetitorVideo[] = [];
  const unresolved: CompetitorScanResult["unresolved"] = [];

  for (const channel of deps.channels) {
    try {
      log(`Resolving ${channel.name}...`);
      const resolved = await deps.youtube.resolveChannel(channel);
      channels.push(resolved);

      const shorts = await deps.youtube.recentShorts(
        resolved,
        channel.name,
        channel.weight,
        deps.maxVideosPerChannel,
        deps.maxShortSeconds,
      );
      log(`  ${channel.name}: ${shorts.length} Short(s).`);
      videos.push(...shorts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`  ${channel.name}: could not resolve — ${reason}`);
      unresolved.push({ channel, reason });
    }
  }

  log(`Analysing ${videos.length} competitor Short(s)...`);
  const insights = await deps.analyst.summarise(videos);

  const events = deps.events.read(scanDate);
  log(`Loaded ${events.length} upcoming event idea(s) from the latest events scan.`);

  log("Building the 30-day plan...");
  const plan = await deps.planner.generate({
    startDate: scanDate,
    planDays: deps.planDays,
    cadence: deps.cadence,
    insights,
    events,
  });
  log(`Plan built: ${plan.slots.length} slot(s) from ${plan.startDate} to ${plan.endDate}.`);

  return { date: scanDate, channels, videos, insights, plan, unresolved };
}
