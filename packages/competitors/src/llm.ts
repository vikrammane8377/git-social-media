/**
 * The tiny slice of the OpenAI Responses API this package uses. Defined here so
 * the package stays testable (a mock is trivial) and the real SDK is only wired
 * up at the edge (openai-client.ts). Matches the SDK:
 * `responses.create({ model, input, tools, reasoning })` returning `output_text`.
 */

/** Reasoning effort levels GPT-6 Astra supports (per the model docs). */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmResponse {
  output_text: string;
}

export interface LlmRequest {
  model: string;
  input: string;
  /** Optional tools, e.g. `[{ type: "web_search" }]` for live web search. */
  tools?: ReadonlyArray<{ type: string }>;
  /** Maps to the Responses API `reasoning.effort`. "medium mode" = "medium". */
  reasoningEffort?: ReasoningEffort;
}

export interface LlmClient {
  create(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * Parse a JSON array from model text. Tolerates ```json fences or a sentence
 * around the array. Returns [] when nothing parseable is found.
 */
export function parseJsonArray(text: string): unknown[] {
  const parsed = parseJsonLoose(text, "[", "]");
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Parse a JSON object from model text, tolerating fences/prose. Returns
 * undefined when nothing parseable is found.
 */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const parsed = parseJsonLoose(text, "{", "}");
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function parseJsonLoose(text: string, open: string, close: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());

  const first = trimmed.indexOf(open);
  const last = trimmed.lastIndexOf(close);
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  candidates.push(trimmed);

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}
