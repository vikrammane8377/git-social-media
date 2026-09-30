import OpenAI from "openai";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

/**
 * Wrap the official OpenAI SDK as our tiny {@link LlmClient}. This is the only
 * place the real SDK is used, so the rest of the package stays testable with a
 * mock. Calls the Responses API with GPT-6 Astra's reasoning effort and the
 * built-in web search tool: `responses.create({ model, input, tools, reasoning })`.
 */
export function createAstraClient(apiKey: string): LlmClient {
  const client = new OpenAI({ apiKey });
  return {
    async create(request: LlmRequest): Promise<LlmResponse> {
      const response = await client.responses.create({
        model: request.model,
        input: request.input,
        // Loosely typed on our side ({ type: string }); the values we pass
        // (e.g. { type: "web_search" }) are valid SDK tools, so cast here.
        tools: request.tools as OpenAI.Responses.Tool[] | undefined,
        reasoning: request.reasoningEffort ? { effort: request.reasoningEffort } : undefined,
      });
      return {
        output_text: response.output_text,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
            }
          : undefined,
      };
    },
  };
}
