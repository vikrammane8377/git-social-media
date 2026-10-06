/** Core types for Component 4: the script writer and AI language reviewer. */

/**
 * An image the writer asks to have generated because no library asset fits. The
 * writer only emits these when the shown library lacks a good reference; the
 * image is synthesised (in Bix's style) in the generate phase and saved to the
 * asset library for reuse.
 */
export interface NeededImage {
  /** Full image-gen prompt in Bix's style (9:16, no on-screen text). */
  prompt: string;
  /** Short label → becomes the saved asset's description/tags/analysis. */
  purpose: string;
}

/**
 * A spoken script for one Short, produced by the writer from a content-plan
 * slot. `scenePrompt` describes the visual scene/motion (no on-screen text);
 * `dialogue` is the line(s) Bix speaks. Together they compose the two-paragraph
 * video prompt the `npm run video` command expects.
 */
export interface ScriptDraft {
  /** Optional working title for the clip. */
  title?: string;
  /** The visual scene + motion description (no on-screen text/captions). */
  scenePrompt: string;
  /** The spoken line(s), in the slot's teaching language. */
  dialogue: string;
  /** Intended clip length in seconds. */
  durationSeconds: number;
  /** Optional writer notes (e.g. locale, the English meaning). */
  notes?: string;
  /**
   * Storage keys of tagged library assets the writer chose as visual references
   * for this script (subset of the assets it was shown). Empty when the writer
   * had no library or chose none, in which case generation falls back to the
   * default reference image.
   */
  usedAssets: string[];
  /**
   * Images the writer asks to have generated because no shown library asset
   * fits. Empty (default) when the library already covers the script's needs;
   * these are synthesised and saved to the library in the generate phase.
   */
  neededImages: NeededImage[];
}

/**
 * The reviewer's verdict for one draft, mirroring the output contract from the
 * AI-language-reviewer spec. `decision` is exactly one of PASS / REVISE /
 * NEEDS_EVIDENCE — never "PASS WITH CHANGES".
 */
export interface ReviewResult {
  decision: "PASS" | "REVISE" | "NEEDS_EVIDENCE";
  /** Plain-English summary of what the post says and teaches. */
  englishMeaning: string;
  /** Whether the witty, mischievous intent survives in the locale. */
  brandVoice: string;
  /** Substantive issues: severity/category/excerpt/explanation/correction. */
  issues: string[];
  /** Each material product claim marked supported/unsupported/contradicted. */
  productClaims: string[];
  /** Which inputs were assessed and which checks were not performed. */
  coverage: string;
  /** Specific unresolved question(s) and the recommended next action. */
  uncertainty: string;
  /** Ready for rendering, revise text, assess missing media, or owner review. */
  nextStep: string;
}

/** The full result of one script-writer run for a single plan slot. */
export interface ScriptResult {
  slotId: string;
  draft: ScriptDraft;
  review: ReviewResult;
  /** How many auto-revisions were performed (0 = passed on the first draft). */
  revisions: number;
  /** The generation-ready prompt composed from the final draft. */
  videoPrompt: string;
}
