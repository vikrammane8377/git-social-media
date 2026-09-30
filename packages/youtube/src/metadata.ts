/**
 * Maps a content-plan slot to YouTube video metadata (snippet + status fields),
 * applying YouTube's length limits and sensible defaults. Callers may override
 * any field from the CLI.
 */

/** YouTube's documented limits for the fields we set. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_TOTAL_MAX = 500;

/** Default category id "27" = Education (from YouTube's videoCategories list). */
export const DEFAULT_CATEGORY_ID = "27";

/** A standard footer appended to auto-built descriptions. */
const DESCRIPTION_FOOTER =
  "—\nCreado por Bix · contenido educativo generado con ayuda de IA.";

/** The subset of a plan slot the metadata mapping needs. */
export interface MetadataSlot {
  readonly topic: string;
  readonly hook: string;
  readonly why: string;
  readonly format: string;
  readonly source: string;
}

/** CLI-supplied overrides; any provided field wins over the slot-derived one. */
export interface MetadataOverrides {
  readonly title?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly categoryId?: string;
  readonly privacyStatus?: string;
  readonly containsSyntheticMedia?: boolean;
}

/** The resolved metadata used to build the upload request body. */
export interface VideoMetadata {
  readonly title: string;
  readonly description: string;
  readonly tags: string[];
  readonly categoryId: string;
  readonly privacyStatus: string;
  /** AI-content disclosure; defaults to true (this pipeline is AI-generated). */
  readonly containsSyntheticMedia: boolean;
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * De-duplicate tags (case-insensitively, first spelling wins) and drop any that
 * would push the running total over YouTube's 500-character budget. The budget
 * counts each tag plus one comma separator between tags.
 */
function clampTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    const cost = tag.length + (out.length > 0 ? 1 : 0);
    if (total + cost > TAGS_TOTAL_MAX) continue;
    seen.add(key);
    out.push(tag);
    total += cost;
  }
  return out;
}

/** Split a topic into individual words usable as tags. */
function topicWords(topic: string): string[] {
  return topic
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

export function slotToMetadata(
  slot: MetadataSlot,
  overrides: MetadataOverrides = {},
): VideoMetadata {
  const title = clamp((overrides.title ?? (slot.hook || slot.topic)).trim(), TITLE_MAX);

  let description: string;
  if (overrides.description !== undefined) {
    description = overrides.description;
  } else {
    const body = [slot.topic, slot.hook, slot.why]
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .join("\n\n");
    description = body.length > 0 ? `${body}\n\n${DESCRIPTION_FOOTER}` : DESCRIPTION_FOOTER;
  }
  description = clamp(description, DESCRIPTION_MAX);

  const tags = clampTags(
    overrides.tags ?? [slot.format, slot.source, ...topicWords(slot.topic)],
  );

  return {
    title,
    description,
    tags,
    categoryId: overrides.categoryId ?? DEFAULT_CATEGORY_ID,
    privacyStatus: overrides.privacyStatus ?? "public",
    containsSyntheticMedia: overrides.containsSyntheticMedia ?? true,
  };
}
