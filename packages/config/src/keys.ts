/**
 * The set of environment keys the product uses, and which component needs each.
 * Keys are added over time; this list is the single source of truth for the
 * config check. Values are NEVER stored here - only names and metadata.
 */
export interface KnownKey {
  /** Environment variable name. */
  readonly name: string;
  /** Which component first needs this key. */
  readonly component: string;
  /** Short human-readable purpose. */
  readonly purpose: string;
}

export const KNOWN_KEYS: readonly KnownKey[] = [
  {
    name: "FAL_KEY",
    component: "Component 1: Video generation (fal Seedance 2.5)",
    purpose: "Authenticate with fal.ai for video generation.",
  },
  {
    name: "OPENAI_API_KEY",
    component: "Components 2-3: scans and planning",
    purpose: "Score topics and summarise patterns via OpenAI.",
  },
  {
    name: "NEWS_API_KEY",
    component: "Component 2: Weekly current-events scan",
    purpose: "Fetch news for the current-events scan.",
  },
  {
    name: "YOUTUBE_API_KEY",
    component: "Component 3: Monthly competitor scan",
    purpose: "Read public YouTube data for competitor Shorts.",
  },
];
