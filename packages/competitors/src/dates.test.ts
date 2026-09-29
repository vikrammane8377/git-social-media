import { describe, it, expect } from "vitest";
import { isIsoDate, addDays, isWithin, monthKey } from "./dates.js";

describe("dates", () => {
  it("validates strict ISO calendar dates", () => {
    expect(isIsoDate("2026-10-01")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("nope")).toBe(false);
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-30", 1)).toBe("2026-10-31");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-01", 29)).toBe("2026-10-30");
  });

  it("checks inclusive windows", () => {
    expect(isWithin("2026-10-15", "2026-10-01", "2026-10-30")).toBe(true);
    expect(isWithin("2026-10-01", "2026-10-01", "2026-10-30")).toBe(true);
    expect(isWithin("2026-11-01", "2026-10-01", "2026-10-30")).toBe(false);
  });

  it("derives the month key", () => {
    expect(monthKey("2026-10-15")).toBe("2026-10");
  });
});
