import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CHANNELS,
  enabledChannels,
  getChannel,
  isChannelId,
  loadChannels,
  readChannelOverrides,
  writeChannelOverrides,
} from "./channels.js";

describe("channel loader merge precedence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bix-channels-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the built-in defaults when no file and no overrides are present", () => {
    const channels = loadChannels(dir);
    expect(channels.map((c) => c.id)).toEqual(["spanish", "global"]);
    expect(channels[0]).toEqual(DEFAULT_CHANNELS.spanish);
    expect(channels[1]).toEqual(DEFAULT_CHANNELS.global);
  });

  it("layers config/channels.json over the defaults", () => {
    writeFileSync(
      join(dir, "channels.json"),
      JSON.stringify({
        channels: {
          spanish: { label: "From File", posting: { time: "07:30" } },
        },
      }),
    );
    const spanish = getChannel("spanish", dir);
    expect(spanish.label).toBe("From File");
    // The file set only the time; timezone keeps inheriting the default.
    expect(spanish.posting.time).toBe("07:30");
    expect(spanish.posting.timezone).toBe(DEFAULT_CHANNELS.spanish.posting.timezone);
  });

  it("layers runtime overrides over both the file and the defaults", () => {
    writeFileSync(
      join(dir, "channels.json"),
      JSON.stringify({ channels: { global: { label: "File Label", enabled: false } } }),
    );
    // Runtime wins over the file; fields the runtime omits fall through to it.
    const global = getChannel("global", dir, { global: { label: "Runtime Label" } });
    expect(global.label).toBe("Runtime Label");
    expect(global.enabled).toBe(false); // from the file, not overridden at runtime
  });

  it("merges metadata and posting field-by-field, not wholesale", () => {
    const spanish = getChannel("spanish", dir, {
      spanish: { metadata: { categoryId: "22" }, posting: { timezone: "UTC" } },
    });
    expect(spanish.metadata.categoryId).toBe("22");
    // Untouched metadata keys survive.
    expect(spanish.metadata.descriptionFooter).toBe(
      DEFAULT_CHANNELS.spanish.metadata.descriptionFooter,
    );
    expect(spanish.posting.timezone).toBe("UTC");
    expect(spanish.posting.time).toBe(DEFAULT_CHANNELS.spanish.posting.time);
  });

  it("defaults each channel's outro CTA to its own language", () => {
    const channels = loadChannels(dir);
    const [spanish, global] = channels;
    expect(spanish.outroCta).toBe(DEFAULT_CHANNELS.spanish.outroCta);
    expect(global.outroCta).toBe(DEFAULT_CHANNELS.global.outroCta);
    // Spanish CTA is Spanish; Global CTA is English.
    expect(spanish.outroCta).toContain("descarga Bix Learn");
    expect(global.outroCta).toContain("download Bix Learn");
  });

  it("overrides outroCta from the file and keeps the default when blank", () => {
    writeFileSync(
      join(dir, "channels.json"),
      JSON.stringify({ channels: { global: { outroCta: "Grab Bix Learn now." } } }),
    );
    expect(getChannel("global", dir).outroCta).toBe("Grab Bix Learn now.");
    // A blank runtime override falls through to the default.
    const spanish = getChannel("spanish", dir, { spanish: { outroCta: "  " } });
    expect(spanish.outroCta).toBe(DEFAULT_CHANNELS.spanish.outroCta);
  });

  it("filters to enabled channels only", () => {
    const enabled = enabledChannels(dir, { global: { enabled: false } });
    expect(enabled.map((c) => c.id)).toEqual(["spanish"]);
  });

  it("ignores blank overrides and keeps the default", () => {
    const spanish = getChannel("spanish", dir, { spanish: { label: "   " } });
    expect(spanish.label).toBe(DEFAULT_CHANNELS.spanish.label);
  });
});

describe("channel override round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bix-channels-rt-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes overrides that readChannelOverrides and the loader read back", () => {
    writeChannelOverrides(dir, {
      spanish: { label: "Español Primo", posting: { time: "14:15" } },
    });
    const back = readChannelOverrides(dir);
    expect(back.spanish?.label).toBe("Español Primo");
    expect(back.spanish?.posting?.time).toBe("14:15");

    // The written file feeds straight back into the loader.
    const spanish = getChannel("spanish", dir);
    expect(spanish.label).toBe("Español Primo");
    expect(spanish.posting.time).toBe("14:15");
  });

  it("returns {} when the file is absent", () => {
    expect(readChannelOverrides(dir)).toEqual({});
  });
});

describe("isChannelId", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isChannelId("spanish")).toBe(true);
    expect(isChannelId("global")).toBe(true);
    expect(isChannelId("french")).toBe(false);
    expect(isChannelId(42)).toBe(false);
    expect(isChannelId(undefined)).toBe(false);
  });
});
