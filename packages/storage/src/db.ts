import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// node:sqlite is a newer Node builtin that bundlers (Vite/vitest) do not yet
// externalize correctly, so load it through require to bypass bundler resolution.
const require = createRequire(import.meta.url);

interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface DatabaseSyncCtor {
  new (location: string): SqliteHandle;
}
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };

/**
 * A small database interface the rest of the app codes against. Today it is
 * backed by SQLite; later it can be re-implemented on PostgreSQL without
 * touching callers. Kept intentionally minimal for the skeleton.
 */
export interface Database {
  /** Run a statement with no result (DDL or writes). */
  exec(sql: string): void;
  /** Run a parameterised write; returns rows changed. */
  run(sql: string, params?: readonly unknown[]): { changes: number };
  /** Fetch the first matching row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T | undefined;
  /** Fetch all matching rows. */
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[];
  /** Close the underlying connection. */
  close(): void;
}

/**
 * SQLite implementation of {@link Database} using Node's built-in node:sqlite.
 * Pass ":memory:" for an ephemeral database (used in tests).
 */
export class SqliteDatabase implements Database {
  private readonly db: SqliteHandle;

  constructor(location: string) {
    if (location !== ":memory:") {
      mkdirSync(dirname(location), { recursive: true });
    }
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    // Wait up to 5s for a briefly-held lock instead of failing immediately with
    // SQLITE_BUSY. The dashboard holds a long-lived writer while a spawned CLI
    // run opens its own connection, so transient write contention is expected.
    this.db.exec("PRAGMA busy_timeout = 5000;");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly unknown[] = []): { changes: number } {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(params as never[]));
    return { changes: Number(result.changes) };
  }

  get<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params as never[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as never[])) as T[];
  }

  close(): void {
    this.db.close();
  }
}
