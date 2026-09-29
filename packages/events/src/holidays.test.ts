import { describe, it, expect } from "vitest";
import { NagerHolidayClient, type FetchLike } from "./holidays.js";

const SAMPLE = [
  { date: "2026-12-25", localName: "Navidad", name: "Christmas Day", countryCode: "MX" },
  { date: "2026-01-01", localName: "Año Nuevo", name: "New Year's Day", countryCode: "MX" },
  { date: "bad-date", localName: "X", name: "X", countryCode: "MX" }, // skipped
];

describe("NagerHolidayClient", () => {
  it("calls the v3 endpoint and maps local + English names", async () => {
    let calledUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => SAMPLE };
    };
    const client = new NagerHolidayClient({ baseUrl: "https://date.nager.at/api/v3", fetchImpl });
    const topics = await client.holidays("MX", 2026);

    expect(calledUrl).toBe("https://date.nager.at/api/v3/PublicHolidays/2026/MX");
    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({
      title: "Navidad (Christmas Day)",
      date: "2026-12-25",
      source: "holiday",
      country: "MX",
    });
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 500, json: async () => [] });
    const client = new NagerHolidayClient({ fetchImpl });
    await expect(client.holidays("MX", 2026)).rejects.toThrow(/500/);
  });
});
