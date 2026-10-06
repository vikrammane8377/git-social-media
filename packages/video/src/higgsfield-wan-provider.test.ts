import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP client so the provider's tool calls are observable and scripted.
const callTool = vi.fn();
vi.mock("@bix/higgsfield", () => ({
  callTool: (name: string, args: Record<string, unknown>) => callTool(name, args),
}));

const { HiggsfieldWanProvider } = await import("./higgsfield-wan-provider.js");
import type { VideoJobInput } from "./types.js";

const baseInput: VideoJobInput = {
  prompt: "Bix says hello",
  imageUrls: ["media-123"],
  resolution: "720p",
  aspectRatio: "9:16",
  duration: 30,
  generateAudio: true,
};

/** A successful generate_video envelope carrying a job id. */
const jobEnvelope = (id: string) => ({
  structuredContent: { results: [{ id }] },
});

/** A preset_recommendation envelope: no job created, decline to proceed. */
const presetEnvelope = (presetId: string) => ({
  structuredContent: {
    notice: {
      type: "preset_recommendation",
      data: { preset: { id: presetId } },
    },
  },
});

beforeEach(() => {
  callTool.mockReset();
});

describe("HiggsfieldWanProvider.submit", () => {
  it("submits with the Wan model + start_image role and returns the job id", async () => {
    callTool.mockResolvedValueOnce(jobEnvelope("job-1"));
    const provider = new HiggsfieldWanProvider();

    const { requestId } = await provider.submit(baseInput);

    expect(requestId).toBe("job-1");
    expect(callTool).toHaveBeenCalledTimes(1);
    const [name, args] = callTool.mock.calls[0];
    expect(name).toBe("generate_video");
    expect(args).toEqual({
      params: {
        model: "wan3_0",
        prompt: "Bix says hello",
        duration: 30,
        aspect_ratio: "9:16",
        resolution: "720p",
        generate_audio: true,
        use_unlim: false,
        medias: [{ value: "media-123", role: "start_image" }],
      },
    });
  });

  it("maps every reference image to a media: start_image then reference_image", async () => {
    callTool.mockResolvedValueOnce(jobEnvelope("job-multi"));
    const provider = new HiggsfieldWanProvider();

    await provider.submit({ ...baseInput, imageUrls: ["media-1", "media-2", "media-3"] });

    const [, args] = callTool.mock.calls[0];
    const params = (args as { params: { medias: Array<{ value: string; role: string }> } }).params;
    expect(params.medias).toEqual([
      { value: "media-1", role: "start_image" },
      { value: "media-2", role: "reference_image" },
      { value: "media-3", role: "reference_image" },
    ]);
  });

  it("declines a preset recommendation and retries literally", async () => {
    callTool
      .mockResolvedValueOnce(presetEnvelope("preset-xyz"))
      .mockResolvedValueOnce(jobEnvelope("job-2"));
    const provider = new HiggsfieldWanProvider();

    const { requestId } = await provider.submit(baseInput);

    expect(requestId).toBe("job-2");
    expect(callTool).toHaveBeenCalledTimes(2);
    const retryArgs = callTool.mock.calls[1][1] as { params: Record<string, unknown> };
    expect(retryArgs.params.declined_preset_id).toBe("preset-xyz");
  });

  it("rejects durations outside Wan's 2-30s whole-second range", async () => {
    const provider = new HiggsfieldWanProvider();
    await expect(provider.submit({ ...baseInput, duration: 45 })).rejects.toThrow(/2-30s/);
    await expect(provider.submit({ ...baseInput, duration: 1 })).rejects.toThrow(/2-30s/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("requires a reference media id", async () => {
    const provider = new HiggsfieldWanProvider();
    await expect(provider.submit({ ...baseInput, imageUrls: [] })).rejects.toThrow(
      /reference image/,
    );
  });

  it("surfaces the server error message when generate_video fails", async () => {
    callTool.mockResolvedValueOnce({
      isError: true,
      structuredContent: { error: "quota exceeded" },
    });
    const provider = new HiggsfieldWanProvider();
    await expect(provider.submit(baseInput)).rejects.toThrow(/quota exceeded/);
  });
});

describe("HiggsfieldWanProvider.status", () => {
  const provider = new HiggsfieldWanProvider();
  const statusCase = async (serverStatus: string) => {
    callTool.mockResolvedValueOnce({
      structuredContent: { generation: { status: serverStatus } },
    });
    return (await provider.status("job-1")).state;
  };

  it("maps queued and pending to IN_QUEUE", async () => {
    expect(await statusCase("queued")).toBe("IN_QUEUE");
    expect(await statusCase("pending")).toBe("IN_QUEUE");
  });

  it("maps in_progress and completed", async () => {
    expect(await statusCase("in_progress")).toBe("IN_PROGRESS");
    expect(await statusCase("completed")).toBe("COMPLETED");
  });

  it("throws on a non-recoverable state", async () => {
    await expect(statusCase("failed")).rejects.toThrow(/non-recoverable/);
  });
});

describe("HiggsfieldWanProvider.result", () => {
  const provider = new HiggsfieldWanProvider();

  it("returns the raw url and seed", async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: {
        generation: { status: "completed", results: { rawUrl: "https://x/v.mp4" }, params: { seed: 42 } },
      },
    });
    expect(await provider.result("job-1")).toEqual({ videoUrl: "https://x/v.mp4", seed: 42 });
  });

  it("throws when a completed job has no video url", async () => {
    callTool.mockResolvedValueOnce({
      structuredContent: { generation: { status: "completed", results: {} } },
    });
    await expect(provider.result("job-1")).rejects.toThrow(/no video URL/);
  });
});
