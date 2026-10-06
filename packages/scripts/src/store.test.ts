import { describe, it, expect } from "vitest";
import { SqliteDatabase } from "@bix/storage";
import { ScriptStore } from "./store.js";
import type { ScriptResult } from "./types.js";

function result(overrides: Partial<ScriptResult> = {}): ScriptResult {
  return {
    slotId: "2026-10-001",
    draft: {
      title: "Coffee dare",
      scenePrompt: "Bix winks in a cafe.",
      dialogue: "A coffee, please.",
      durationSeconds: 5,
      usedAssets: [],
      neededImages: [],
    },
    review: {
      decision: "PASS",
      englishMeaning: "Order a coffee in English.",
      brandVoice: "Witty preserved.",
      issues: [],
      productClaims: [],
      coverage: "Text only.",
      uncertainty: "",
      nextStep: "ready for rendering",
    },
    revisions: 0,
    videoPrompt: "scene\n\nBix speaks: \"A coffee, please.\"",
    ...overrides,
  };
}

describe("ScriptStore", () => {
  it("initialises, saves and reads back a script", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ScriptStore(db);
    store.init();

    store.save(result());
    expect(store.count("2026-10-001")).toBe(1);

    const row = db.get<{
      decision: string;
      revisions: number;
      video_prompt: string;
      review_json: string;
    }>("SELECT decision, revisions, video_prompt, review_json FROM scripts WHERE slot_id = ?", ["2026-10-001"]);
    expect(row?.decision).toBe("PASS");
    expect(row?.revisions).toBe(0);
    expect(row?.video_prompt).toContain("A coffee, please.");
    expect(JSON.parse(row?.review_json ?? "{}").nextStep).toBe("ready for rendering");

    db.close();
  });

  it("replaces the row on re-save for the same slot (no duplicate)", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ScriptStore(db);
    store.init();

    store.save(result({ revisions: 0, review: { ...result().review, decision: "REVISE" } }));
    store.save(result({ revisions: 2, review: { ...result().review, decision: "PASS" } }));

    expect(store.count("2026-10-001")).toBe(1);
    const row = db.get<{ decision: string; revisions: number }>(
      "SELECT decision, revisions FROM scripts WHERE slot_id = ?",
      ["2026-10-001"],
    );
    expect(row?.decision).toBe("PASS");
    expect(row?.revisions).toBe(2);

    db.close();
  });

  it("round-trips assets_used", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ScriptStore(db);
    store.init();

    store.save(
      result({ draft: { ...result().draft, usedAssets: ["assets/uploads/a.png", "assets/uploads/b.png"] } }),
    );

    const row = db.get<{ assets_used: string }>(
      "SELECT assets_used FROM scripts WHERE slot_id = ?",
      ["2026-10-001"],
    );
    expect(JSON.parse(row?.assets_used ?? "[]")).toEqual([
      "assets/uploads/a.png",
      "assets/uploads/b.png",
    ]);

    db.close();
  });

  it("round-trips needed_images", () => {
    const db = new SqliteDatabase(":memory:");
    const store = new ScriptStore(db);
    store.init();

    store.save(
      result({
        draft: {
          ...result().draft,
          neededImages: [{ prompt: "Bix with a flag.", purpose: "national-day hero" }],
        },
      }),
    );

    const row = db.get<{ needed_images: string }>(
      "SELECT needed_images FROM scripts WHERE slot_id = ?",
      ["2026-10-001"],
    );
    expect(JSON.parse(row?.needed_images ?? "[]")).toEqual([
      { prompt: "Bix with a flag.", purpose: "national-day hero" },
    ]);

    db.close();
  });

  it("migrates a pre-existing scripts table that lacks needed_images", () => {
    const db = new SqliteDatabase(":memory:");
    // Simulate an older DB with assets_used but no needed_images column.
    db.exec(`
      CREATE TABLE scripts (
        slot_id          TEXT PRIMARY KEY,
        title            TEXT,
        scene_prompt     TEXT NOT NULL,
        dialogue         TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        video_prompt     TEXT NOT NULL,
        decision         TEXT NOT NULL,
        review_json      TEXT NOT NULL,
        revisions        INTEGER NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        assets_used      TEXT NOT NULL DEFAULT '[]'
      )
    `);

    const store = new ScriptStore(db);
    store.init(); // should ALTER TABLE to add needed_images
    store.save(
      result({
        draft: { ...result().draft, neededImages: [{ prompt: "p", purpose: "u" }] },
      }),
    );

    const row = db.get<{ needed_images: string }>(
      "SELECT needed_images FROM scripts WHERE slot_id = ?",
      ["2026-10-001"],
    );
    expect(JSON.parse(row?.needed_images ?? "[]")).toEqual([{ prompt: "p", purpose: "u" }]);

    db.close();
  });

  it("migrates a pre-existing scripts table that lacks assets_used", () => {
    const db = new SqliteDatabase(":memory:");
    // Simulate an older DB created before the assets_used column existed.
    db.exec(`
      CREATE TABLE scripts (
        slot_id          TEXT PRIMARY KEY,
        title            TEXT,
        scene_prompt     TEXT NOT NULL,
        dialogue         TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        video_prompt     TEXT NOT NULL,
        decision         TEXT NOT NULL,
        review_json      TEXT NOT NULL,
        revisions        INTEGER NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);

    const store = new ScriptStore(db);
    store.init(); // should ALTER TABLE to add assets_used
    store.save(result({ draft: { ...result().draft, usedAssets: ["assets/uploads/x.png"] } }));

    const row = db.get<{ assets_used: string }>(
      "SELECT assets_used FROM scripts WHERE slot_id = ?",
      ["2026-10-001"],
    );
    expect(JSON.parse(row?.assets_used ?? "[]")).toEqual(["assets/uploads/x.png"]);

    db.close();
  });
});
