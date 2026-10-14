/**
 * Pure title helpers for ffmpeg `drawtext`. `drawtext` does not word-wrap, so we
 * compute the line breaks in JS and feed it ready-wrapped, multi-line text. Kept
 * free of any ffmpeg/filesystem calls so it is trivially unit-testable.
 */

export interface WrapOptions {
  /** Soft maximum characters per line before wrapping to the next line. */
  maxCharsPerLine: number;
  /** Hard cap on lines; the last line is ellipsised when the title overflows. */
  maxLines: number;
}

/**
 * Greedy word-wrap a title into at most `maxLines` lines of roughly
 * `maxCharsPerLine` characters. A single word longer than the limit keeps its
 * own line (we never split mid-word). When the text does not fit, the final line
 * is truncated and given a trailing ellipsis. Pure and deterministic.
 */
export function wrapTitle(title: string, opts: WrapOptions): string[] {
  const max = Math.max(1, Math.floor(opts.maxCharsPerLine));
  const maxLines = Math.max(1, Math.floor(opts.maxLines));
  const words = title.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= max) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);

  if (lines.length <= maxLines) return lines;

  // Overflow: keep the first maxLines lines and ellipsise the last one.
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length > max - 1 ? `${last.slice(0, Math.max(1, max - 1))}…` : `${last}…`;
  return kept;
}

/**
 * Escape a string for use as a SINGLE-QUOTED ffmpeg filtergraph value, e.g.
 * `drawtext=text='<escaped>'` or `fontfile='<escaped>'`. Inside single quotes
 * `:` and `,` are literal, so only three things need handling: backslashes,
 * literal percents (drawtext treats `%` as an expansion), and the single quote
 * itself — which per ffmpeg's quoting rules must close the quote, add an escaped
 * quote, and reopen (`'\''`). Newlines are preserved so multi-line titles render
 * as separate lines.
 */
export function escapeDrawText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/'/g, "'\\''");
}
