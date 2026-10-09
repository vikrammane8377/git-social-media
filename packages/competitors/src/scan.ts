import type { YouTubeClient } from "./youtube.js";
import type { OpenAiCompetitorAnalyst } from "./insights.js";
import type { OpenAiPlanGenerator, Cadence } from "./plan.js";
import type { EventIdea } from "./events-source.js";
import type {
  ChannelConfig,
  ContentPlan,
  CompetitorScanResult,
  CompetitorVideo,
  ResolvedChannel,
} from "./types.js";
import { monthKey, toIsoDate } from "./dates.js";

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
  /**
   * One planner per enabled posting channel. Competitor analysis runs once and
   * is shared; each planner turns the same insights/events into that channel's
   * slots, and the slots are merged into a single plan.
   */
  planners: readonly Planner[];
  events: EventsReader;
  channels: readonly ChannelConfig[];
  maxVideosPerChannel: number;
  maxShortSeconds: number;
  planDays: number;
  targets: { eventSlots: number; competitorSlots: number };
  cadence: Cadence;
  today?: Date;
  logger?: (message: string) => void;
}

/**
 * Run one competitor scan end to end:
 *   resolve channels -> pull recent Shorts -> summarise patterns
 *   -> read latest events -> generate the content plan.
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

  log(
    `Building plans for ${deps.planners.length} channel(s): aiming for ` +
      `${deps.targets.eventSlots} event + ${deps.targets.competitorSlots} competitor slot(s) each...`,
  );
  const perChannel: ContentPlan[] = [];
  for (const planner of deps.planners) {
    const channelPlan = await planner.generate({
      startDate: scanDate,
      planDays: deps.planDays,
      targets: deps.targets,
      cadence: deps.cadence,
      insights,
      events,
    });
    perChannel.push(channelPlan);
  }

  const plan = mergePlans(perChannel, scanDate, deps.cadence.timezone);
  const byEvent = plan.slots.filter((s) => s.source === "event").length;
  const byComp = plan.slots.length - byEvent;
  log(
    `Plan built: ${plan.slots.length} slot(s) (${byEvent} event, ${byComp} competitor) ` +
      `across ${perChannel.length} channel(s), from ${plan.startDate} to ${plan.endDate}.`,
  );

  return { date: scanDate, channels, videos, insights, plan, unresolved };
}

/**
 * Merge per-channel plans into one. Each planner uses the same start date and
 * targets, so the windows match; we keep the widest span, concatenate slots and
 * order them by date then channel so a day's channels stay grouped. Falls back
 * to the scan date / shared cadence timezone when no plan was produced.
 */
function mergePlans(plans: readonly ContentPlan[], scanDate: string, timezone: string): ContentPlan {
  const slots = plans
    .flatMap((p) => p.slots)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0,
    );
  const startDate = plans.reduce((min, p) => (p.startDate < min ? p.startDate : min), plans[0]?.startDate ?? scanDate);
  const endDate = plans.reduce((max, p) => (p.endDate > max ? p.endDate : max), plans[0]?.endDate ?? scanDate);
  return {
    month: plans[0]?.month ?? monthKey(scanDate),
    startDate,
    endDate,
    timezone: plans[0]?.timezone ?? timezone,
    slots,
  };
}
