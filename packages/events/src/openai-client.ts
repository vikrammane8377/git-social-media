import OpenAI from "openai";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

/**
 * Wrap the official OpenAI SDK as our tiny {@link LlmClient}. This is the only
 * place the real SDK is used, so the rest of the package stays testable with a
 * mock. Calls the Responses API: `responses.create({ model, input, tools })`.
 */
export function createOpenAiClient(apiKey: string): LlmClient {
  const client = new OpenAI({ apiKey });
  return {
    async create(request: LlmRequest): Promise<LlmResponse> {
      const response = await client.responses.create({
        model: request.model,
        input: request.input,
        // Our LlmRequest keeps tools loosely typed ({ type: string }); the values we
        // pass (e.g. { type: "web_search" }) are valid SDK tools, so cast here.
        tools: request.tools as OpenAI.Responses.Tool[] | undefined,
      });
      return { output_text: response.output_text };
    },
  };
}
