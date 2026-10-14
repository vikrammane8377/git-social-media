import { describe, it, expect } from "vitest";
import { ImageGenerator, type ImageGenClient, type ImageGenRequest } from "./image-generator.js";
import { BIX_MASCOT_DESCRIPTION } from "./asset-analyzer.js";
import type { NeededImage } from "./types.js";

function fakeClient(captured: { last?: ImageGenRequest }): ImageGenClient {
  return {
    async generate(req: ImageGenRequest) {
      captured.last = req;
      return { bytes: Buffer.from("IMG"), mime: "image/png" };
    },
  };
}

const need: NeededImage = {
  prompt: "Bix waving a Mexican flag on a sunny plaza for Día de la Independencia.",
  purpose: "mexico national-day hero still",
};

describe("ImageGenerator", () => {
  it("builds a style-anchored prompt (mascot, 9:16, no on-screen text) and returns bytes", async () => {
    const captured: { last?: ImageGenRequest } = {};
    const generator = new ImageGenerator({
      client: fakeClient(captured),
      model: "gpt-image-2.5-sunburst",
      size: "1024x1536",
    });

    const image = await generator.generate(need);

    expect(image.bytes).toEqual(Buffer.from("IMG"));
    expect(image.mime).toBe("image/png");

    const prompt = captured.last?.prompt ?? "";
    expect(prompt).toContain(BIX_MASCOT_DESCRIPTION);
    expect(prompt).toContain("9:16");
    expect(prompt.toLowerCase()).toContain("no on-screen text");
    // The requested scene is embedded verbatim.
    expect(prompt).toContain(need.prompt);
    // Model + size are forwarded unchanged.
    expect(captured.last?.model).toBe("gpt-image-2.5-sunburst");
    expect(captured.last?.size).toBe("1024x1536");
  });

  it("forwards reference images for subject/style consistency", async () => {
    const captured: { last?: ImageGenRequest } = {};
    const generator = new ImageGenerator({
      client: fakeClient(captured),
      model: "m",
      size: "1024x1536",
    });

    const references = [{ bytes: Buffer.from("REF"), mime: "image/png" }];
    await generator.generate(need, references);

    expect(captured.last?.referenceImages).toEqual(references);
  });

  it("omits referenceImages when none are provided", async () => {
    const captured: { last?: ImageGenRequest } = {};
    const generator = new ImageGenerator({
      client: fakeClient(captured),
      model: "m",
      size: "1024x1536",
    });

    await generator.generate(need);

    expect(captured.last?.referenceImages).toBeUndefined();
  });

  it("appends brand art direction to the prompt when set", async () => {
    const captured: { last?: ImageGenRequest } = {};
    const artDirection = "Clean, uncluttered backdrop; soft flattering lighting.";
    const generator = new ImageGenerator({
      client: fakeClient(captured),
      model: "m",
      size: "1024x1536",
      artDirection,
    });

    await generator.generate(need);

    expect(captured.last?.prompt).toContain(artDirection);
  });

  it("omits the art-direction line when unset or blank", async () => {
    const captured: { last?: ImageGenRequest } = {};
    const generator = new ImageGenerator({
      client: fakeClient(captured),
      model: "m",
      size: "1024x1536",
      artDirection: "   ",
    });

    await generator.generate(need);

    // Prompt ends with the guardrail line, not a trailing art-direction line.
    const prompt = captured.last?.prompt ?? "";
    expect(prompt.endsWith("watermarks or logos.")).toBe(true);
  });
});
