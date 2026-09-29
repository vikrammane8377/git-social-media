import { describe, it, expect } from "vitest";
import { calendarTopics } from "./calendar.js";

describe("calendarTopics", () => {
  it("maps valid entries and skips invalid ones", () => {
    const topics = calendarTopics([
      { title: "Halloween", date: "2026-10-31", country: "US", url: "https://ex/hw" },
      { title: "Día de Muertos", date: "2026-11-01", endDate: "2026-11-02" },
      { title: "", date: "2026-10-01" }, // no title -> skipped
      { title: "Bad date", date: "31-10-2026" }, // bad date -> skipped
    ]);
    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({ title: "Halloween", source: "calendar", sourceUrl: "https://ex/hw" });
    expect(topics[1].endDate).toBe("2026-11-02");
  });

  it("defaults a missing URL to a curated-calendar label", () => {
    const [topic] = calendarTopics([{ title: "Christmas", date: "2026-12-25" }]);
    expect(topic.sourceUrl).toBe("(curated calendar)");
  });
});
