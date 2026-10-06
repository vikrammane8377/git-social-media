import { useEffect, useState } from "react";

/** Minimal data-loading hook: runs `fn` on mount (and when `deps` change). */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: React.DependencyList,
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

/** A coloured status chip. Class is derived from the (lowercased) label. */
export function Chip({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="chip none">—</span>;
  const cls = value.toLowerCase().replace(/[^a-z_]/g, "_");
  return <span className={`chip ${cls}`}>{value}</span>;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function ErrorMsg({ message }: { message: string }) {
  return <p className="error">Error: {message}</p>;
}
