/** ISO YYYY-MM-DD helpers (plain calendar dates, UTC-based). */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Inclusive check that `iso` falls within [start, end]. */
export function isWithin(iso: string, start: string, end: string): boolean {
  return isIsoDate(iso) && iso >= start && iso <= end;
}

/** "YYYY-MM" for a given ISO date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
