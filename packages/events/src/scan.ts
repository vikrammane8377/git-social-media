import type { EventSearchProvider } from "./event-search.js";
import type { HolidayClient } from "./holidays.js";
import type { TopicScorer } from "./scoring.js";
import type { BlockedTopic, RawTopic, ScanResult, ScoredTopic } from "./types.js";
import { checkBlocklist } from "./blocklist.js";
import { mergeTopics } from "./merge.js";
import { addDays, isWithin, toIsoDate, yearsInRange } from "./dates.js";
import { ideaId } from "./store.js";

export interface ScanDeps {
  search: EventSearchProvider;
  holidays: HolidayClient;
  scorer: TopicScorer;
  /** Owner-curated topics already loaded from config. */
  calendar: RawTopic[];
  /** ISO codes whose official holidays to include. */
  holidayCountries: readonly string[];
  /** ISO codes the web search should target. */
  searchCountries: readonly string[];
  weeksAhead: number;
  /** Extra blocklist keywords from config. */
  blocklistKeywords: readonly string[];
  /** Override "now" for deterministic tests. */
  today?: Date;
  logger?: (message: string) => void;
}

/**
 * Run one events scan end to end:
 *   gather (web + holidays + curated) -> merge/dedupe -> keep only in-window
 *   -> blocklist (pre) -> score -> blocklist (post) -> ScanResult.
 * Pure with respect to storage: it returns the result; the CLI persists it and
 * writes the report.
 */
export async function runScan(deps: ScanDeps): Promise<ScanResult> {
  const log = deps.logger ?? (() => {});
  const now = deps.today ?? new Date();
  const scanDate = toIsoDate(now);
  const windowStart = scanDate;
  const windowEnd = addDays(scanDate, deps.weeksAhead * 7);

  // 1. Web search.
  log("Searching the web for upcoming topics...");
  const webTopics = await deps.search.search({
    countries: deps.searchCountries,
    weeksAhead: deps.weeksAhead,
    today: scanDate,
  });
  log(`Web search returned ${webTopics.length} topic(s).`);

  // 2. Official holidays for each country across every year the window spans.
  const years = yearsInRange(windowStart, windowEnd);
  const holidayTopics: RawTopic[] = [];
  for (const country of deps.holidayCountries) {
    for (const year of years) {
      const hs = await deps.holidays.holidays(country, year);
      holidayTopics.push(...hs);
    }
  }
  log(`Holiday API returned ${holidayTopics.length} holiday(s).`);

  // 3. Merge (authoritative sources first) + dedupe, then keep only in-window.
  const merged = mergeTopics(holidayTopics, deps.calendar, webTopics);
  const inWindow = merged.filter((t) => isWithin(t.date, windowStart, windowEnd));
  log(`${inWindow.length} topic(s) in the ${windowStart}..${windowEnd} window after dedupe.`);

  // 4. Blocklist before scoring.
  const blocked: BlockedTopic[] = [];
  const survivors: RawTopic[] = [];
  for (const topic of inWindow) {
    const hit = checkBlocklist(topic, deps.blocklistKeywords);
    if (hit) {
      blocked.push({ topic, reason: `${hit.category}: ${hit.keyword}`, stage: "pre" });
    } else {
      survivors.push(topic);
    }
  }
  log(`${survivors.length} topic(s) passed the pre-scoring blocklist; scoring...`);

  // 5. Score the survivors.
  const scores = await deps.scorer.score(survivors);

  // 6. Blocklist after scoring (the model's reason text can reveal sensitivity),
  //    then assemble kept ideas. Topics with no score are dropped.
  const kept: ScoredTopic[] = [];
  for (let i = 0; i < survivors.length; i += 1) {
    const topic = survivors[i];
    const score = scores.get(i);
    if (!score) continue;

    const hit = checkBlocklist(topic, deps.blocklistKeywords, score.reason);
    if (hit) {
      blocked.push({ topic, reason: `${hit.category}: ${hit.keyword}`, stage: "post" });
      continue;
    }

    kept.push({ ...topic, id: ideaId(scanDate, topic.title, topic.date), score });
  }
  log(`Scan complete: ${kept.length} kept, ${blocked.length} blocked.`);

  return { date: scanDate, kept, blocked };
}
