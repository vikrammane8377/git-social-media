import type { ScriptDraft } from "./types.js";

/**
 * Compose the generation-ready prompt for `npm run video` from a script draft.
 *
 * The video command reads a single prompt file: the first paragraph is the
 * visual scene/motion, and (for the talking providers wan/veo/kling) the spoken
 * line is embedded in the prompt itself. We emit exactly two paragraphs:
 *
 *   <scene paragraph>
 *
 *   <dialogue paragraph>
 *
 * Pure and deterministic: the same draft always yields the same string. The
 * `provider` is accepted so the shape can adapt per provider if needed; today
 * wan/veo/kling all speak the dialogue embedded in the prompt, so the shape is
 * shared. No on-screen text is ever requested (that guardrail lives upstream).
 */
export function composeVideoPrompt(draft: ScriptDraft, provider: string): string {
  const scene = draft.scenePrompt.trim();
  const dialogue = draft.dialogue.trim();

  // "avatar" takes its spoken line via --script, not embedded in the prompt, so
  // the emitted prompt is the scene only for that provider.
  if (provider === "avatar") {
    return scene;
  }

  const spoken =
    `Bix speaks the line below in a witty and mischievous tone, but at a relaxed, ` +
    `natural, unhurried pace — clear and conversational, enunciated with small ` +
    `pauses between sentences, never rushed or sped up: "${dialogue}"`;
  return `${scene}\n\n${spoken}`;
}
