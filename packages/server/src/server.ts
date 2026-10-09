import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadEnv } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import { AssetAnalyzer, createSolClient, loadScriptWriterConfig } from "@bix/scripts";
import { createApp } from "./app.js";
import { DashboardReader } from "./read.js";
import { MediaService } from "./media.js";
import { JobManager } from "./jobs.js";
import { RunsStore } from "./runs-store.js";
import { AssetsStore } from "./assets-store.js";
import { SettingsStore } from "./settings-store.js";

/**
 * Boots the dashboard API: opens the same `data/bix.db` the CLI writes, builds
 * the read layer + trigger machinery, and serves over HTTP. In production it
 * also serves the built SPA (apps/web/dist) so the whole app is single-origin.
 *
 * Config via env:
 *   PORT           HTTP port (default 8787)
 *   BIX_DB         SQLite path   (default <root>/data/bix.db)
 *   BIX_ROOT       repo root that holds data/ + outputs/ (default cwd)
 *   DASHBOARD_TOKEN if set, require Authorization: Bearer on /api/*
 *   NODE_ENV=production → spawn built CLI + serve apps/web/dist
 */
export interface StartServerOptions {
  port?: number;
  root?: string;
  dbPath?: string;
}

export function startServer(options: StartServerOptions = {}): { port: number; close: () => void } {
  loadEnv();

  const root = options.root ?? process.env.BIX_ROOT ?? process.cwd();
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const dbPath = options.dbPath ?? process.env.BIX_DB ?? join(root, "data", "bix.db");

  const db = new SqliteDatabase(dbPath);
  const reader = new DashboardReader(db);
  const storage = new LocalFileStorage(root);
  const media = new MediaService(storage);

  const runsStore = new RunsStore(db);
  runsStore.init();
  const jobs = new JobManager({ store: runsStore, root });

  const assetsStore = new AssetsStore(db);
  assetsStore.init();

  const settingsStore = new SettingsStore(db, join(root, "config"));
  settingsStore.init();

  // Vision analyzer for uploaded assets — only when an OpenAI key is present.
  // Reuses the script writer's model + guardrails from config/script-writer.json.
  const openAiKey = process.env.OPENAI_API_KEY;
  const assetAnalyzer = openAiKey
    ? (() => {
        const cfg = loadScriptWriterConfig(join(root, "config"));
        return new AssetAnalyzer({
          client: createSolClient(openAiKey),
          model: cfg.model,
          reasoningEffort: cfg.reasoningEffort,
          productFacts: cfg.productFacts,
        });
      })()
    : undefined;

  const app = createApp({
    reader,
    media,
    root,
    jobs,
    runsStore,
    assetsStore,
    settingsStore,
    storage,
    assetAnalyzer,
    authToken: process.env.DASHBOARD_TOKEN,
  });

  // In production, serve the built SPA and fall back to index.html for the
  // client-side router. In dev, Vite serves the SPA and proxies /api here.
  const distDir = join(root, "apps", "web", "dist");
  if (process.env.NODE_ENV === "production" && existsSync(distDir)) {
    app.use("/*", serveStatic({ root: "./apps/web/dist" }));
    app.get("/*", serveStatic({ path: "./apps/web/dist/index.html" }));
  }

  const server = serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`@bix/server listening on http://localhost:${port}`);

  return {
    port,
    close: () => {
      server.close();
      db.close();
    },
  };
}

// Run directly: `tsx packages/server/src/server.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
