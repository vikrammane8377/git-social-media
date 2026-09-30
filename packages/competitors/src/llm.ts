/**
 * The tiny slice of the OpenAI Responses API this package uses. Defined here so
 * the package stays testable (a mock is trivial) and the real SDK is only wired
 * up at the edge (openai-client.ts). Matches the SDK:
 * `responses.create({ model, input, tools, reasoning })` returning `output_text`.
 */

/** Reasoning effort levels GPT-6 Astra supports (per the model docs). */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Token counts the provider reports for a single call. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  output_text: string;
  /** Token usage for the call, when the provider reports it. */
  usage?: Usage;
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

/** Model pricing in USD per one million tokens (from the model docs). */
export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Running totals an accumulating client exposes. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Calls that requested web search (each carries an extra per-call tool fee). */
  webSearchCalls: number;
}

export interface CostBreakdown extends UsageTotals {
  inputCost: number;
  outputCost: number;
  /** Token cost only. Web-search per-call fees are billed separately by OpenAI. */
  total: number;
}

/** Turn token totals into dollars at the given pricing (token cost only). */
export function computeCost(totals: UsageTotals, pricing: Pricing): CostBreakdown {
  const inputCost = (totals.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (totals.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return { ...totals, inputCost, outputCost, total: inputCost + outputCost };
}

/**
 * Wraps an {@link LlmClient} to accumulate token usage across every call, so a
 * run can report how much it actually spent. Web-search calls are counted
 * separately because they carry an extra per-call fee not included in token
 * pricing (billed by OpenAI separately). Reports zero tokens honestly when the
 * provider does not return usage — never invents numbers.
 */
export class UsageTrackingClient implements LlmClient {
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;
  private webSearchCalls = 0;

  constructor(private readonly inner: LlmClient) {}

  async create(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.inner.create(request);
    this.calls += 1;
    if (request.tools?.some((t) => t.type === "web_search")) this.webSearchCalls += 1;
    if (response.usage) {
      this.inputTokens += response.usage.inputTokens;
      this.outputTokens += response.usage.outputTokens;
    }
    return response;
  }

  totals(): UsageTotals {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      calls: this.calls,
      webSearchCalls: this.webSearchCalls,
    };
  }
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
