import { describe, it, expect } from "vitest";
import { OpenAiEventSearch } from "./openai-search.js";
import type { LlmClient } from "./llm.js";

function clientReturning(text: string): { client: LlmClient; lastRequest: () => unknown } {
  let last: unknown;
  const client: LlmClient = {
    create: async (req) => {
      last = req;
      return { output_text: text };
    },
  };
  return { client, lastRequest: () => last };
}

describe("OpenAiEventSearch", () => {
  it("requests web search and keeps only valid, in-window topics", async () => {
    const payload = JSON.stringify([
      { title: "Film premiere", summary: "A big release", date: "2026-10-20", url: "https://ex/film", country: "US" },
      { title: "No url", date: "2026-10-21" }, // discarded: missing url
      { title: "No date", url: "https://ex/x" }, // discarded: missing date
      { title: "Out of window", date: "2027-05-01", url: "https://ex/late" }, // discarded: too far
      { title: "Bad url", date: "2026-10-22", url: "ftp://ex" }, // discarded: not http(s)
    ]);
    const { client, lastRequest } = clientReturning(payload);
    const search = new OpenAiEventSearch({ client, model: "gpt-5.6" });

    const topics = await search.search({ countries: ["US"], weeksAhead: 6, today: "2026-10-01" });

    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ title: "Film premiere", source: "web", sourceUrl: "https://ex/film" });

    const req = lastRequest() as { tools?: Array<{ type: string }> };
    expect(req.tools?.[0]?.type).toBe("web_search");
  });

  it("returns [] when the model gives no parseable array", async () => {
    const { client } = clientReturning("Sorry, I could not find anything.");
    const search = new OpenAiEventSearch({ client, model: "gpt-5.6" });
    const topics = await search.search({ countries: ["US"], weeksAhead: 6, today: "2026-10-01" });
    expect(topics).toEqual([]);
  });

  it("parses JSON wrapped in a code fence", async () => {
    const fenced = "```json\n[{\"title\":\"Fair\",\"date\":\"2026-10-10\",\"url\":\"https://ex/fair\"}]\n```";
    const { client } = clientReturning(fenced);
    const search = new OpenAiEventSearch({ client, model: "gpt-5.6" });
    const topics = await search.search({ countries: ["MX"], weeksAhead: 6, today: "2026-10-01" });
    expect(topics).toHaveLength(1);
    expect(topics[0].title).toBe("Fair");
  });
});
