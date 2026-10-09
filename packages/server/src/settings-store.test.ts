import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "@bix/storage";
import { SettingsStore } from "./settings-store.js";

describe("SettingsStore", () => {
  let dir: string;
  let db: SqliteDatabase;
  let store: SettingsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bix-settings-"));
    db = new SqliteDatabase(":memory:");
    store = new SettingsStore(db, dir);
    store.init();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns sane publish defaults before anything is saved", () => {
    expect(store.getPublishDefaults()).toEqual({
      privacy: "public",
      provider: null,
      maxRevisions: null,
      captions: true,
    });
  });

  it("round-trips publish defaults through the settings table", () => {
    const saved = store.setPublishDefaults({ privacy: "unlisted", maxRevisions: 2 });
    expect(saved.privacy).toBe("unlisted");
    expect(saved.maxRevisions).toBe(2);
    // A fresh store over the same db reads the persisted value back.
    const reopened = new SettingsStore(db, dir);
    expect(reopened.getPublishDefaults().privacy).toBe("unlisted");
    expect(reopened.getPublishDefaults().maxRevisions).toBe(2);
  });

  it("merges a partial publish update onto the stored value", () => {
    store.setPublishDefaults({ privacy: "private", captions: false });
    const next = store.setPublishDefaults({ provider: "wan" });
    // Earlier fields survive the partial update.
    expect(next.privacy).toBe("private");
    expect(next.captions).toBe(false);
    expect(next.provider).toBe("wan");
  });

  it("rejects an unknown privacy and falls back to the default", () => {
    const saved = store.setPublishDefaults({ privacy: "secret" });
    expect(saved.privacy).toBe("public");
  });

  it("round-trips channel overrides through config/channels.json", () => {
    store.setChannelOverrides({ global: { label: "Bix Worldwide", enabled: false } });
    expect(store.getChannelOverrides().global?.label).toBe("Bix Worldwide");

    // resolvedChannels reflects the written override on top of the defaults.
    const global = store.resolvedChannels().find((c) => c.id === "global");
    expect(global?.label).toBe("Bix Worldwide");
    expect(global?.enabled).toBe(false);
  });
});
