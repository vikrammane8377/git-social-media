import { describe, it, expect } from "vitest";
import { AssetAnalyzer } from "./asset-analyzer.js";
import type { LlmClient, LlmRequest } from "./llm.js";

function mockClient(output: string, captured?: { last?: LlmRequest }): LlmClient {
  return {
    async create(request: LlmRequest) {
      if (captured) captured.last = request;
      return { output_text: output };
    },
  };
}

const deps = (client: LlmClient) => ({
  client,
  model: "gpt-5.6-sol",
  reasoningEffort: "medium" as const,
  productFacts: ["No free/unlimited claims.", "No on-screen text."],
});

const input = {
  bytes: Buffer.from([1, 2, 3, 4]),
  mime: "image/png",
  filename: "cafe.png",
  tags: ["cafe"],
  description: "A cafe shot",
};

describe("AssetAnalyzer", () => {
  it("sends the image as a data URL and the project context in the prompt", async () => {
    const captured: { last?: LlmRequest } = {};
    const output = JSON.stringify({ description: "A cafe backdrop.", tags: ["cafe", "indoor"] });
    const analyzer = new AssetAnalyzer(deps(mockClient(output, captured)));

    await analyzer.analyze(input);

    const req = captured.last;
    expect(req?.model).toBe("gpt-5.6-sol");
    expect(req?.reasoningEffort).toBe("medium");
    // The image is passed as a base64 data URL.
    expect(req?.images?.[0]).toBe(`data:image/png;base64,${input.bytes.toString("base64")}`);
    // The prompt carries the brand, a guardrail, and the uploader's fields.
    expect(req?.input).toContain("Bix Learn");
    expect(req?.input).toContain("No on-screen text.");
    expect(req?.input).toContain("cafe");
    expect(req?.input).toContain("A cafe shot");
    // It asks for selection-critical facets: attire, props, and occasion-fit.
    expect(req?.input).toContain("WEARING");
    expect(req?.input).toContain("OCCASION");
    expect(req?.input.toLowerCase()).toContain("flag");
  });

  it("parses description + tags and normalises tags (lowercase, de-duped)", async () => {
    const output = JSON.stringify({ description: "A cafe backdrop.", tags: ["Cafe", "cafe", "Indoor"] });
    const analyzer = new AssetAnalyzer(deps(mockClient(output)));

    const result = await analyzer.analyze(input);

    expect(result.analysis).toBe("A cafe backdrop.");
    expect(result.tags).toEqual(["cafe", "indoor"]);
  });

  it("falls back to raw prose with no tags when the reply is not JSON", async () => {
    const analyzer = new AssetAnalyzer(deps(mockClient("Just a cafe, nothing structured.")));
    const result = await analyzer.analyze(input);
    expect(result.analysis).toBe("Just a cafe, nothing structured.");
    expect(result.tags).toEqual([]);
  });

  it("defaults the data URL mime when none is given", async () => {
    const captured: { last?: LlmRequest } = {};
    const analyzer = new AssetAnalyzer(deps(mockClient("{}", captured)));
    await analyzer.analyze({ ...input, mime: "" });
    expect(captured.last?.images?.[0]).toContain("data:image/png;base64,");
  });
});
