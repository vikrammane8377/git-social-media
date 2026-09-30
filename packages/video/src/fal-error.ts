/**
 * fal's client throws a ValidationError whose useful reason lives in
 * `body.detail` (an array of `{ loc, msg }`, or a string). The top-level
 * `message` is only the generic HTTP status ("Unprocessable Entity"). This
 * flattens the detail into a readable one-line message so failures explain
 * themselves instead of surfacing a bare status.
 */
export function falErrorMessage(err: unknown): string {
  const e = err as {
    body?: { detail?: Array<{ loc?: unknown[]; msg?: string }> | string };
    message?: string;
  };
  const detail = e?.body?.detail;
  const generic = e?.message ?? String(err);

  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const where = Array.isArray(d.loc)
          ? d.loc.filter((x) => x !== "body").join(".")
          : "";
        return where ? `${where}: ${d.msg ?? ""}` : String(d.msg ?? "");
      })
      .filter((p) => p.length > 0);
    if (parts.length > 0) return `${generic} - ${parts.join("; ")}`;
  } else if (typeof detail === "string" && detail.length > 0) {
    return `${generic} - ${detail}`;
  }
  return generic;
}
