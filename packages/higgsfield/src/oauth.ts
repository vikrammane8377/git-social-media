import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { AddressInfo } from "node:net";

/**
 * OAuth 2.1 Authorization Code flow with PKCE against Higgsfield's auth provider
 * (Clerk). Higgsfield's MCP server is OAuth-only. We register a public client
 * dynamically, open the provider's consent page in a browser, and capture the
 * authorization code on a short-lived loopback server - the standard pattern for
 * CLI logins (gh, gcloud). `offline_access` is requested so we receive a refresh
 * token and can renew the access token silently.
 *
 * Tokens are secrets: written only to `data/` (gitignored) and never logged.
 */

/** Higgsfield's Clerk authorization-server metadata document. */
const AUTH_SERVER_METADATA_URL =
  "https://clerk.higgsfield.ai/.well-known/oauth-authorization-server";

/** Scopes the MCP resource advertises; offline_access yields a refresh token. */
const SCOPE = "openid email offline_access";

/** Loopback port for the redirect. Must match the registered redirect_uri. */
const REDIRECT_PORT = 4123;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/** Renew the access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000;

export interface AuthServerMetadata {
  readonly authorization_endpoint: string;
  readonly registration_endpoint: string;
  readonly token_endpoint: string;
  readonly revocation_endpoint?: string;
}

export interface StoredTokens {
  readonly clientId: string;
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
  readonly clientId: string;
  /** Resolves once the user approves and the code is exchanged for tokens. */
  waitForTokens(): Promise<StoredTokens>;
}

/** Thrown when there is no usable token and the user must run the login flow. */
export class NeedsLoginError extends Error {
  constructor(message = "Not signed in to Higgsfield. Run the login command.") {
    super(message);
    this.name = "NeedsLoginError";
  }
}

function tokenPath(): string {
  return join(process.cwd(), "data", "higgsfield-tokens.json");
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

/** Fetch the authorization-server metadata (endpoints, registration URL). */
export async function fetchAuthServerMetadata(): Promise<AuthServerMetadata> {
  const res = await fetch(AUTH_SERVER_METADATA_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Could not read Higgsfield auth metadata (${res.status} ${res.statusText}).`,
    );
  }
  const md = (await res.json()) as Partial<AuthServerMetadata>;
  if (!md.authorization_endpoint || !md.registration_endpoint || !md.token_endpoint) {
    throw new Error("Higgsfield auth metadata is missing required endpoints.");
  }
  return md as AuthServerMetadata;
}

/**
 * Register this client dynamically (RFC 7591). Public client using the
 * authorization-code (PKCE) and refresh-token grants; no client secret.
 */
async function registerClient(md: AuthServerMetadata): Promise<string> {
  const res = await fetch(md.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Bix Social Console",
      application_type: "native",
      redirect_uris: [REDIRECT_URI],
      response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) {
    throw new Error("Client registration succeeded but returned no client_id.");
  }
  return data.client_id;
}

/**
 * Start the login: register (if needed), build the consent URL, and start a
 * loopback server that captures the authorization code. The caller shows
 * {@link LoginHandle.authUrl} to the user, then awaits waitForTokens().
 */
export async function startLogin(): Promise<LoginHandle> {
  const metadata = await fetchAuthServerMetadata();
  const existing = await load();
  const clientId = existing?.clientId ?? (await registerClient(metadata));

  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const codePromise = captureAuthCode(state);

  return {
    authUrl: authUrl.toString(),
    clientId,
    waitForTokens: async () => {
      const code = await codePromise;
      const tokens = await exchangeCode(metadata, clientId, code, verifier);
      await save(tokens);
      return tokens;
    },
  };
}

/** Run a one-shot loopback server and resolve with the authorization code. */
function captureAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
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
      res.end("<h2>Signed in to Higgsfield.</h2><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      // Confirm we bound the expected port.
      const addr = server.address() as AddressInfo | null;
      if (!addr || addr.port !== REDIRECT_PORT) {
        server.close();
        reject(new Error(`Could not bind loopback port ${REDIRECT_PORT}.`));
      }
    });
  });
}

function toStoredTokens(
  clientId: string,
  raw: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  },
): StoredTokens {
  const now = Date.now();
  return {
    clientId,
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: now + (raw.expires_in ?? 3600) * 1000,
    scope: raw.scope,
    tokenType: raw.token_type,
    obtainedAt: now,
  };
}

/** Exchange an authorization code for tokens (PKCE, public client). */
async function exchangeCode(
  md: AuthServerMetadata,
  clientId: string,
  code: string,
  verifier: string,
): Promise<StoredTokens> {
  const res = await fetch(md.token_endpoint, {
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
  return toStoredTokens(clientId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  });
}

/** Exchange a refresh token for a new access token. */
export async function refresh(tokens: StoredTokens): Promise<StoredTokens> {
  if (!tokens.refreshToken) throw new NeedsLoginError();
  const metadata = await fetchAuthServerMetadata();
  const res = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: tokens.clientId,
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
  const next = toStoredTokens(tokens.clientId, {
    access_token: data.access_token,
    // Some servers rotate refresh tokens; keep the old one if none returned.
    refresh_token: data.refresh_token ?? tokens.refreshToken,
    expires_in: data.expires_in,
    scope: data.scope,
    token_type: data.token_type,
  });
  await save(next);
  return next;
}

/**
 * Return a valid access token, refreshing silently if it is expiring. Throws
 * {@link NeedsLoginError} when there is no token or the refresh token is dead.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await load();
  if (!tokens) throw new NeedsLoginError();
  if (tokens.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return tokens.accessToken;
  }
  const refreshed = await refresh(tokens);
  return refreshed.accessToken;
}

export async function load(): Promise<StoredTokens | undefined> {
  try {
    const raw = await readFile(tokenPath(), "utf8");
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return undefined;
  }
}

async function save(tokens: StoredTokens): Promise<void> {
  const path = tokenPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}
