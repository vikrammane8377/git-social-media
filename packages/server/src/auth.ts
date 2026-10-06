import type { MiddlewareHandler } from "hono";

/**
 * Deploy-time auth seam. In local dev `DASHBOARD_TOKEN` is unset and this
 * middleware is a no-op, so the dashboard is open on localhost. When the token
 * is set (e.g. in a deployed environment), every `/api/*` request must carry
 * `Authorization: Bearer <token>`.
 *
 * This is intentionally simple: a single shared token gates the read+trigger
 * API. Full multi-user auth / token provisioning is a documented follow-up (see
 * docs/STATUS.md) — the browser never holds provider secrets regardless.
 */
export function bearerAuth(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!token) {
      // No token configured → open (local dev).
      await next();
      return;
    }
    const header = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
