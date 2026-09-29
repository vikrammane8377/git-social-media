import type { RawTopic } from "./types.js";

/**
 * Built-in sensitive categories. Each is a set of lowercase keywords/phrases we
 * never want on a light language-learning brand. The scan runs this before AND
 * after scoring so nothing sensitive slips through. It deliberately errs toward
 * caution: a false positive just drops one topic, which is the safe direction.
 */
export const BUILT_IN_CATEGORIES: Record<string, string[]> = {
  death: ["death", "dead", "dies", "died", "killed", "fatal", "fatality", "obituary", "funeral", "mourning", "rip"],
  disaster: [
    "disaster",
    "earthquake",
    "hurricane",
    "flood",
    "wildfire",
    "tsunami",
    "tornado",
    "landslide",
    "catastrophe",
    "evacuat",
  ],
  tragedy: ["tragedy", "tragic", "massacre", "shooting", "stabbing", "terror", "bombing", "hostage"],
  war: ["war", "invasion", "airstrike", "missile", "troops", "ceasefire", "genocide", "militant"],
  crime: ["crime", "murder", "homicide", "assault", "kidnap", "robbery", "arrest", "trafficking", "scandal", "fraud"],
  politics: [
    "election",
    "president",
    "senate",
    "parliament",
    "congress",
    "referendum",
    "campaign",
    "protest",
    "impeach",
    "coup",
    "political party",
  ],
  health_scare: [
    "outbreak",
    "pandemic",
    "epidemic",
    "virus",
    "disease",
    "infection",
    "contamination",
    "recall",
    "poisoning",
    "overdose",
  ],
};

/** A blocklist hit: which category and which keyword triggered it. */
export interface BlocklistMatch {
  category: string;
  keyword: string;
}

/** Lowercase and collapse whitespace for matching. */
function haystack(topic: RawTopic, extraText: string): string {
  return `${topic.title} ${topic.summary} ${extraText}`.toLowerCase();
}

/**
 * Return the first blocklist match for a topic, or null if it is clear.
 * `extraText` lets the post-scoring pass also scan the model's reason text.
 */
export function checkBlocklist(
  topic: RawTopic,
  extraKeywords: readonly string[] = [],
  extraText = "",
): BlocklistMatch | null {
  const text = haystack(topic, extraText);

  for (const [category, keywords] of Object.entries(BUILT_IN_CATEGORIES)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) return { category, keyword };
    }
  }

  for (const keyword of extraKeywords) {
    const k = keyword.trim().toLowerCase();
    if (k && text.includes(k)) return { category: "config", keyword: k };
  }

  return null;
}
