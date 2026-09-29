import { describe, it, expect } from "vitest";
import { isIsoDate, toIsoDate, addDays, isWithin, yearsInRange } from "./dates.js";

describe("dates", () => {
  it("accepts real ISO dates and rejects malformed or impossible ones", () => {
    expect(isIsoDate("2026-10-31")).toBe(true);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("not-a-date")).toBe(false);
    expect(isIsoDate(20261031)).toBe(false);
  });

  it("formats and adds days in UTC", () => {
    expect(toIsoDate(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("checks inclusive windows", () => {
    expect(isWithin("2026-10-15", "2026-10-01", "2026-11-01")).toBe(true);
    expect(isWithin("2026-10-01", "2026-10-01", "2026-11-01")).toBe(true);
    expect(isWithin("2026-11-01", "2026-10-01", "2026-11-01")).toBe(true);
    expect(isWithin("2026-09-30", "2026-10-01", "2026-11-01")).toBe(false);
  });

  it("lists the years a window spans", () => {
    expect(yearsInRange("2026-01-01", "2026-12-31")).toEqual([2026]);
    expect(yearsInRange("2026-12-20", "2027-01-15")).toEqual([2026, 2027]);
  });
});
