import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { AddressInfo } from "node:net";
import { requireKey, type ChannelId } from "@bix/config";

/**
 * OAuth 2.0 Authorization Code flow with PKCE against Google, for the YouTube
 * Data API v3 upload scope. Unlike Higgsfield, Google does NOT support dynamic
 * client registration, so the owner creates a Desktop-app OAuth client in the
 * Google Cloud Console and puts its credentials in `.env`
 * (`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`). These are "public client"
 * credentials for an installed app; PKCE (S256) is the real protection, but
 * Google still requires the client_secret on the token endpoint.
 *
 * We open Google's consent page in a browser and capture the authorization code
 * on a short-lived loopback server (the standard pattern for CLI logins).
 * `access_type=offline` + `prompt=select_account consent` guarantee a refresh
 * token so the access token renews silently, and always show the account chooser
 * so a repeat login can switch to a different Google account or Brand-Account
 * channel instead of silently reusing the first one.
 *
 * Tokens are secrets: written only to `data/` (gitignored, chmod 0600) and
 * never logged.
 */

/** Google's OAuth 2.0 endpoints for installed/desktop apps. */
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Scopes we need: `youtube.upload` inserts videos; the broader `youtube`
 * (manage) scope is required to flip an existing video's privacy via
 * `videos.update`. Adding a scope invalidates old tokens — re-run `login`.
 */
const SCOPE = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
].join(" ");

/** Loopback port for the redirect (4123 is Higgsfield's; YouTube uses 4124). */
const REDIRECT_PORT = 4124;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;

/** Renew the access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000;

export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch ms when the access token expires. */
  readonly expiresAt: number;
  readonly scope?: string;
  readonly tokenType?: string;
  /** Epoch ms when these tokens were obtained. */
  readonly obtainedAt: number;
}

export interface LoginHandle {
  /** URL the user opens to sign in and consent. */
  readonly authUrl: string;
  /** Resolves once the user approves and the code is exchanged for tokens. */
  waitForTokens(): Promise<StoredTokens>;
}

/** Thrown when there is no usable token and the user must run the login flow. */
export class NeedsLoginError extends Error {
  constructor(message = "Not signed in to YouTube. Run the login command.") {
    super(message);
    this.name = "NeedsLoginError";
  }
}

/** The channel whose token the legacy single-file store is treated as. */
const DEFAULT_CHANNEL: ChannelId = "spanish";

/** Per-channel token file, e.g. `data/youtube-tokens.spanish.json`. */
function tokenPath(channel: ChannelId): string {
  return join(process.cwd(), "data", `youtube-tokens.${channel}.json`);
}

/**
 * The pre-multi-channel single token file. Kept only so an existing deployment
 * keeps working as the `spanish` channel until the owner re-logs in per channel.
 */
function legacyTokenPath(): string {
  return join(process.cwd(), "data", "youtube-tokens.json");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Generate a PKCE verifier/challenge pair (S256). */
function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Read the owner-provided Desktop-app credentials from the environment. */
function clientCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: requireKey("YOUTUBE_CLIENT_ID"),
    clientSecret: requireKey("YOUTUBE_CLIENT_SECRET"),
  };
}

/**
 * Start the login: build the consent URL and start a loopback server that
 * captures the authorization code. The caller shows {@link LoginHandle.authUrl}
 * to the user, then awaits waitForTokens().
 */
export async function startLogin(channel: ChannelId = DEFAULT_CHANNEL): Promise<LoginHandle> {
  const { clientId, clientSecret } = clientCredentials();
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Guarantee a refresh token on every consent, even for a repeat login, and
  // always show the account chooser so a repeat login can switch Google account
  // or Brand-Account channel (otherwise Google silently reuses the first one).
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "select_account consent");

  const codePromise = captureAuthCode(state);

  return {
    authUrl: authUrl.toString(),
    waitForTokens: async () => {
      const code = await codePromise;
      const tokens = await exchangeCode(clientId, clientSecret, code, verifier);
      await save(tokens, channel);
      return tokens;
    },
  };
}

/** Run a one-shot loopback server and resolve with the authorization code. */
function captureAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // Google redirects to the loopback root with the code in the query.
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      res.writeHead(200, { "content-type": "text/html" });
      if (error) {
        res.end(`<h2>Authorization failed: ${error}</h2><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.end("<h2>Invalid authorization response.</h2><p>You can close this tab.</p>");
        server.close();
        reject(new Error("Invalid authorization response (missing code or state mismatch)."));
        return;
      }
      res.end("<h2>Signed in to YouTube.</h2><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      // Confirm we bound the expected port (it must match the registered redirect_uri).
      const addr = server.address() as AddressInfo | null;
      if (!addr || addr.port !== REDIRECT_PORT) {
        server.close();
        reject(new Error(`Could not bind loopback port ${REDIRECT_PORT}.`));
      }
    });
  });
}

function toStoredTokens(raw: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}): StoredTokens {
  const now = Date.now();
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: now + (raw.expires_in ?? 3600) * 1000,
    scope: raw.scope,
    tokenType: raw.token_type,
    obtainedAt: now,
  };
}

/** Exchange an authorization code for tokens (PKCE + client_secret). */
async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
): Promise<StoredTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token exchange failed: ${data.error_description ?? data.error ?? res.statusText}`,
    );
  }
  return toStoredTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  });
}

/** Exchange a refresh token for a new access token. */
export async function refresh(
  tokens: StoredTokens,
  channel: ChannelId = DEFAULT_CHANNEL,
): Promise<StoredTokens> {
  if (!tokens.refreshToken) throw new NeedsLoginError();
  const { clientId, clientSecret } = clientCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    // Refresh token dead or revoked: the human must sign in again.
    throw new NeedsLoginError(
      `Refresh failed (${data.error ?? res.statusText}); sign in again.`,
    );
  }
  const next = toStoredTokens({
    access_token: data.access_token,
    // Google keeps the same refresh token across refreshes; retain it.
    refresh_token: data.refresh_token ?? tokens.refreshToken,
    expires_in: data.expires_in,
    scope: data.scope ?? tokens.scope,
    token_type: data.token_type,
  });
  await save(next, channel);
  return next;
}

/**
 * Return a valid access token, refreshing silently if it is expiring. Throws
 * {@link NeedsLoginError} when there is no token or the refresh token is dead.
 */
export async function getAccessToken(channel: ChannelId = DEFAULT_CHANNEL): Promise<string> {
  const tokens = await load(channel);
  if (!tokens) throw new NeedsLoginError();
  if (tokens.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return tokens.accessToken;
  }
  const refreshed = await refresh(tokens, channel);
  return refreshed.accessToken;
}

export async function load(channel: ChannelId = DEFAULT_CHANNEL): Promise<StoredTokens | undefined> {
  const direct = await readTokens(tokenPath(channel));
  if (direct) return direct;
  // Back-compat: treat the old single token file as the spanish channel's,
  // so an existing deployment keeps publishing until a per-channel re-login.
  if (channel === DEFAULT_CHANNEL) return readTokens(legacyTokenPath());
  return undefined;
}

async function readTokens(path: string): Promise<StoredTokens | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return undefined;
  }
}

async function save(tokens: StoredTokens, channel: ChannelId = DEFAULT_CHANNEL): Promise<void> {
  const path = tokenPath(channel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}
