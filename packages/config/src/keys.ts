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
    purpose: "Score topics, summarise patterns, and run web search via OpenAI.",
  },
  {
    name: "YOUTUBE_API_KEY",
    component: "Component 3: Monthly competitor scan",
    purpose: "Read public YouTube data for competitor Shorts.",
  },
  {
    name: "YOUTUBE_CLIENT_ID",
    component: "Component 5: Publish generated video to YouTube",
    purpose: "Desktop-app OAuth client id for uploading videos (public client).",
  },
  {
    name: "YOUTUBE_CLIENT_SECRET",
    component: "Component 5: Publish generated video to YouTube",
    purpose: "Desktop-app OAuth client secret paired with the client id.",
  },
  {
    name: "CAPTIONS",
    component: "Component 6: Burn-in captions (OpusClip)",
    purpose: "Authenticate with the OpusClip API to caption generated videos.",
  },
];
