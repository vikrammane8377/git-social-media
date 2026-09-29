/** Core types for the monthly competitor scan and 30-day content plan. */

/** A tracked competitor channel, as configured by the owner. */
export interface ChannelConfig {
  /** A YouTube @handle (e.g. "@Duolingo") OR a channel id (e.g. "UC..."). */
  handle?: string;
  id?: string;
  /** Human-readable name used in reports. */
  name: string;
  /** Relative weight when learning patterns (Falou is weighted lower). */
  weight: number;
}

/** A resolved channel: identity plus its uploads playlist. */
export interface ResolvedChannel {
  channelId: string;
  title: string;
  uploadsPlaylistId: string;
  subscriberCount?: number;
  videoCount?: number;
}

/** One public video's metadata from the YouTube Data API. Counts are public. */
export interface CompetitorVideo {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  weight: number;
}

/**
 * The model's read of competitor patterns. Formats/trends only; it must never
 * copy scripts. Reach here is public counts only (can't show organic vs paid).
 */
export interface CompetitorInsights {
  formats: string[];
  hooks: string[];
  lengths: string;
  postingRhythm: string;
  themes: string[];
  ctas: string[];
  notes: string[];
}

/** Where a plan slot's idea came from. */
export type SlotSource = "event" | "competitor" | "evergreen";

/** One day in the 30-day plan. */
export interface PlanSlot {
  date: string;
  time: string;
  format: string;
  source: SlotSource;
  topic: string;
  brandFit: number;
  hook: string;
  why: string;
  assets: string[];
}

/** The full plan the scan produces. */
export interface ContentPlan {
  /** Plan identifier, e.g. "2026-10" (YYYY-MM of the start date). */
  month: string;
  startDate: string;
  endDate: string;
  timezone: string;
  slots: PlanSlot[];
}

/** The full result of one competitor scan. */
export interface CompetitorScanResult {
  date: string;
  channels: ResolvedChannel[];
  videos: CompetitorVideo[];
  insights: CompetitorInsights;
  plan: ContentPlan;
  /** Channels that could not be resolved, with the reason (never silent). */
  unresolved: { channel: ChannelConfig; reason: string }[];
}
