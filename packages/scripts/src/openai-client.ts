import OpenAI from "openai";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

/**
 * Wrap the official OpenAI SDK as our tiny {@link LlmClient}. This is the only
 * place the real SDK is used, so the rest of the package stays testable with a
 * mock. Calls the Responses API with GPT-5.6 Sol's reasoning effort:
 * `responses.create({ model, input, tools, reasoning })`. The script writer and
 * reviewer need no web-search tool, so tools are only forwarded when supplied.
 */
export function createSolClient(apiKey: string): LlmClient {
  const client = new OpenAI({ apiKey });
  return {
    async create(request: LlmRequest): Promise<LlmResponse> {
      // With images, send a multimodal Responses input (text + input_image data
      // URLs). Without, the plain string path is byte-identical to before so the
      // writer/reviewer behave exactly as they did.
      const input =
        request.images && request.images.length > 0
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: request.input },
                  ...request.images.map((url) => ({
                    type: "input_image",
                    image_url: url,
                    detail: "auto",
                  })),
                ],
              },
            ]
          : request.input;
      const response = await client.responses.create({
        model: request.model,
        input: input as OpenAI.Responses.ResponseCreateParamsNonStreaming["input"],
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
