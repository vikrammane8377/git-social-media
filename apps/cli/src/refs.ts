/**
 * Pure helpers for the orchestrator's reference-image resolution, extracted so
 * they can be unit-tested without touching the filesystem, the OpenAI SDK or the
 * database. Used by {@link runOrchestrate} after the script phase to decide which
 * images feed the video provider and which one becomes the YouTube thumbnail.
 */

/** Fallback reference when the writer chose nothing and generated nothing. */
export const DEFAULT_REF = "assets/bix_stand.png";

/**
 * Decide the reference images for the video, in priority order:
 *   1. explicit `--ref` flags always win (owner override);
 *   2. otherwise the assets the writer selected plus any freshly generated ones;
 *   3. otherwise the default stand image.
 */
export function selectRefs(
  explicit: readonly string[],
  usedAssets: readonly string[],
  generated: readonly string[],
): string[] {
  if (explicit.length > 0) return [...explicit];
  const combined = [...usedAssets, ...generated];
  return combined.length > 0 ? combined : [DEFAULT_REF];
}

/**
 * Pick the key to use as the custom YouTube thumbnail: a freshly generated still
 * is preferred (it was made for this exact Short), otherwise the first ref. Undefined
 * when there is nothing to use.
 */
export function pickThumbnailKey(
  generated: readonly string[],
  refs: readonly string[],
): string | undefined {
  return generated[0] ?? refs[0];
}

/** Map a storage key's extension to an image MIME type (defaults to png). */
export function mimeFromKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/png";
  }
}
