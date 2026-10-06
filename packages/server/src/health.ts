import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkKeys, type KeyStatus } from "@bix/config";

/**
 * Read-only health checks for the dashboard. Nothing here ever returns a secret
 * value: env keys report only present/missing, and OAuth checks report only
 * whether a token file exists and parses (plus a non-sensitive expiry, if any).
 * The UI uses this to tell the user, before they trigger anything, whether
 * generate (Higgsfield) and publish (YouTube) will actually work.
 */

export interface EnvStatus {
  readonly keys: readonly KeyStatus[];
}

export interface OAuthProviderStatus {
  /** Provider label, e.g. "youtube" or "higgsfield". */
  readonly provider: string;
  /** True when the token file exists and parses as JSON. */
  readonly loggedIn: boolean;
  /** True when the file exists at all (may still be unparseable). */
  readonly present: boolean;
  /** ISO time the access token expires, if the file recorded one. */
  readonly expiresAt: string | null;
  /** True when we can tell the token is already past its expiry. */
  readonly expired: boolean;
}

export interface OAuthStatus {
  readonly providers: readonly OAuthProviderStatus[];
}

/** Present/missing for every known env key (values never included). */
export function envStatus(env: NodeJS.ProcessEnv = process.env): EnvStatus {
  return { keys: checkKeys(undefined, env) };
}

interface TokenFile {
  expiresAt?: number;
}

function readTokenStatus(provider: string, path: string): OAuthProviderStatus {
  const present = existsSync(path);
  if (!present) {
    return { provider, loggedIn: false, present: false, expiresAt: null, expired: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TokenFile;
    const expiresAtMs =
      typeof parsed.expiresAt === "number" ? parsed.expiresAt : null;
    return {
      provider,
      loggedIn: true,
      present: true,
      expiresAt: expiresAtMs != null ? new Date(expiresAtMs).toISOString() : null,
      expired: expiresAtMs != null ? expiresAtMs <= Date.now() : false,
    };
  } catch {
    // File exists but is unreadable/corrupt: present but not usable.
    return { provider, loggedIn: false, present: true, expiresAt: null, expired: false };
  }
}

/**
 * Does each provider have a usable-looking token on disk? `root` is the repo
 * root that holds the gitignored `data/` directory (defaults to cwd).
 */
export function oauthStatus(root: string = process.cwd()): OAuthStatus {
  const dataDir = join(root, "data");
  return {
    providers: [
      readTokenStatus("youtube", join(dataDir, "youtube-tokens.json")),
      readTokenStatus("higgsfield", join(dataDir, "higgsfield-tokens.json")),
    ],
  };
}

/** True when the named provider has a usable token (used by the trigger guardrails). */
export function isLoggedIn(provider: string, root: string = process.cwd()): boolean {
  return oauthStatus(root).providers.some((p) => p.provider === provider && p.loggedIn);
}
