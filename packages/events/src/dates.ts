/** ISO YYYY-MM-DD helpers. All dates in this package are plain calendar dates. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a strict YYYY-MM-DD string that is also a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Format a Date as YYYY-MM-DD in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Add whole days to an ISO date, returning a new ISO date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Inclusive check that `iso` falls within [start, end]. */
export function isWithin(iso: string, start: string, end: string): boolean {
  return isIsoDate(iso) && iso >= start && iso <= end;
}

/** Years spanned by the window [start, end], e.g. 2026 or [2026, 2027]. */
export function yearsInRange(start: string, end: string): number[] {
  const from = Number(start.slice(0, 4));
  const to = Number(end.slice(0, 4));
  const years: number[] = [];
  for (let y = from; y <= to; y += 1) years.push(y);
  return years;
}
