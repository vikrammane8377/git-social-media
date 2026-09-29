import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { KNOWN_KEYS, type KnownKey } from "./keys.js";

/**
 * Walk upwards from a starting directory to find the repository root
 * (the directory that contains a .env or .env.example file).
 */
function findEnvDir(startDir: string): string {
  let dir = startDir;
  // Stop at the filesystem root.
  for (;;) {
    if (existsSync(resolve(dir, ".env")) || existsSync(resolve(dir, ".env.example"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

let loaded = false;

/**
 * Load .env into process.env exactly once. Existing process.env values win,
 * so real environment variables are not overwritten by the file.
 */
export function loadEnv(): void {
  if (loaded) return;
  const here = dirname(fileURLToPath(import.meta.url));
  const envDir = findEnvDir(here);
  dotenv.config({ path: resolve(envDir, ".env"), override: false });
  loaded = true;
}

export interface KeyStatus {
  readonly name: string;
  readonly component: string;
  readonly purpose: string;
  /** True when the key is defined and non-empty. The value itself is never exposed. */
  readonly present: boolean;
}

/** A key is present only when it is defined and not just whitespace. */
function isPresent(raw: string | undefined): boolean {
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Report the present/missing status of every known key. Never returns or logs
 * the underlying value.
 */
export function checkKeys(
  keys: readonly KnownKey[] = KNOWN_KEYS,
  env: NodeJS.ProcessEnv = process.env,
): KeyStatus[] {
  return keys.map((k) => ({
    name: k.name,
    component: k.component,
    purpose: k.purpose,
    present: isPresent(env[k.name]),
  }));
}

/**
 * Read a single required key's value for internal use by a component. Throws if
 * missing. The value is returned to the caller but must never be logged.
 */
export function requireKey(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (!isPresent(raw)) {
    throw new Error(`Missing required key: ${name}. Add it to .env.`);
  }
  return raw as string;
}
