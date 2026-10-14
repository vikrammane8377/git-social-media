import type { AssetReader, AssetRecord } from "./asset-reader.js";
import type { PlanSlotReader } from "./plan-slot-reader.js";
import type { OpenAiScriptWriter } from "./writer.js";
import type { OpenAiScriptReviewer } from "./reviewer.js";
import type { ScriptStore } from "./store.js";
import { composeVideoPrompt } from "./prompt.js";
import type { ScriptResult } from "./types.js";

/** The writer/reviewer as narrow interfaces, so tests can mock them. */
export type Writer = Pick<OpenAiScriptWriter, "write" | "revise">;
export type Reviewer = Pick<OpenAiScriptReviewer, "review">;

export interface RunScriptWriterDeps {
  reader: PlanSlotReader;
  writer: Writer;
  reviewer: Reviewer;
  store: ScriptStore;
  /** Optional tagged-image library; when present the writer may auto-select refs. */
  assetReader?: AssetReader;
  /** Auto-revise at most this many times before stopping. */
  maxRevisions: number;
  /** Provider the emitted prompt targets (shapes the composed prompt). */
  provider: string;
  slotId: string;
  /**
   * Optional vision inputs (data URLs) forwarded to the writer on both the
   * initial write and every revise — e.g. a feature screenshot the writer should
   * demo. Absent for non-feature slots.
   */
  images?: readonly string[];
  logger?: (message: string) => void;
}

/**
 * Run the script writer for one plan slot, end to end:
 *   read slot -> write draft -> review -> while REVISE and under the revision
 *   cap: revise -> review again -> compose the generation-ready prompt ->
 *   persist -> return the result.
 *
 * PASS is a success (the prompt is ready to generate). REVISE that exhausts the
 * cap, or NEEDS_EVIDENCE, is reported as not-ready — the CLI turns that into a
 * non-zero exit. No video is generated and no credits are spent here.
 */
export async function runScriptWriter(deps: RunScriptWriterDeps): Promise<ScriptResult> {
  const log = deps.logger ?? (() => {});

  const slot = deps.reader.getById(deps.slotId);
  if (!slot) {
    throw new Error(
      `No plan slot found with id "${deps.slotId}". Run the competitor scan first, or check the id.`,
    );
  }

  const assets: AssetRecord[] = deps.assetReader?.list() ?? [];
  if (assets.length > 0) {
    log(`Asset library: ${assets.length} image(s) available for auto-selection.`);
  }

  log(`Writing a script for slot ${slot.id} (${slot.format} — ${slot.topic})...`);
  let draft = await deps.writer.write(slot, assets, deps.images);
  let review = await deps.reviewer.review(slot, draft);
  log(`Reviewer decision: ${review.decision}.`);

  let revisions = 0;
  while (review.decision === "REVISE" && revisions < deps.maxRevisions) {
    revisions += 1;
    log(`Revising (attempt ${revisions} of ${deps.maxRevisions})...`);
    draft = await deps.writer.revise(slot, draft, review, assets, deps.images);
    review = await deps.reviewer.review(slot, draft);
    log(`Reviewer decision: ${review.decision}.`);
  }
  if (draft.usedAssets.length > 0) {
    log(`Writer selected ${draft.usedAssets.length} reference asset(s).`);
  }
  if (draft.neededImages.length > 0) {
    log(`Writer requested ${draft.neededImages.length} image(s) to generate.`);
  }

  const videoPrompt = composeVideoPrompt(draft, deps.provider);
  const result: ScriptResult = { slotId: slot.id, draft, review, revisions, videoPrompt };
  deps.store.save(result);
  return result;
}
