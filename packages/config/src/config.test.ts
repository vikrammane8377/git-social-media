import { describe, it, expect } from "vitest";
import { checkKeys, requireKey } from "./config.js";
import { KNOWN_KEYS } from "./keys.js";

describe("checkKeys", () => {
  it("reports one status per known key", () => {
    const statuses = checkKeys(KNOWN_KEYS, {});
    expect(statuses).toHaveLength(KNOWN_KEYS.length);
    expect(statuses.map((s) => s.name).sort()).toEqual(
      KNOWN_KEYS.map((k) => k.name).sort(),
    );
  });

  it("marks a key present only when defined and non-empty", () => {
    const statuses = checkKeys(
      [{ name: "FOO", component: "c", purpose: "p" }],
      { FOO: "abc" },
    );
    expect(statuses[0]!.present).toBe(true);
  });

  it("treats missing, empty and whitespace-only values as absent", () => {
    for (const value of [undefined, "", "   "]) {
      const statuses = checkKeys(
        [{ name: "FOO", component: "c", purpose: "p" }],
        { FOO: value as string | undefined } as NodeJS.ProcessEnv,
      );
      expect(statuses[0]!.present).toBe(false);
    }
  });

  it("never includes the underlying value in its output", () => {
    const secret = "super-secret-value";
    const statuses = checkKeys(
      [{ name: "FOO", component: "c", purpose: "p" }],
      { FOO: secret },
    );
    expect(JSON.stringify(statuses)).not.toContain(secret);
  });
});

describe("requireKey", () => {
  it("returns the value when present", () => {
    expect(requireKey("FOO", { FOO: "bar" })).toBe("bar");
  });

  it("throws when missing, without leaking a value", () => {
    expect(() => requireKey("FOO", {})).toThrowError(/Missing required key: FOO/);
  });
});
