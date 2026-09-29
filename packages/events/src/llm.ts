/**
 * The tiny slice of the OpenAI Responses API this package uses. Defining it
 * ourselves keeps the package testable (a mock is trivial) and means the real
 * SDK is only wired up at the edge (the CLI). Field names match the SDK:
 * `responses.create({ model, input, tools })` returns an object exposing
 * `output_text`.
 */
export interface LlmResponse {
  output_text: string;
}

export interface LlmRequest {
  model: string;
  input: string;
  /** Optional tools, e.g. `[{ type: "web_search" }]` for live web search. */
  tools?: ReadonlyArray<{ type: string }>;
}

export interface LlmClient {
  create(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * Parse a JSON array out of a model's text output. Tolerates the common cases of
 * the model wrapping JSON in ```json fences or adding a sentence around it.
 * Returns [] if nothing parseable is found (callers treat that as "no topics").
 */
export function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const candidates: string[] = [];

  // Fenced ```json ... ``` or ``` ... ``` block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());

  // The substring from the first '[' to the last ']'.
  const first = trimmed.indexOf("[");
  const last = trimmed.lastIndexOf("]");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  // The whole thing, as-is.
  candidates.push(trimmed);

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return [];
}
