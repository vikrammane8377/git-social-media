import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { FileStorage } from "@bix/storage";
import { bearerAuth } from "./auth.js";
import { envStatus, oauthStatus, isLoggedIn } from "./health.js";
import { MediaAccessError, type MediaService } from "./media.js";
import type { DashboardReader } from "./read.js";
import type { JobManager } from "./jobs.js";
import type { RunKind, RunsStore } from "./runs-store.js";
import type { AssetsStore } from "./assets-store.js";

/**
 * Framework wiring only. All real logic lives in read/health/media/jobs so it is
 * unit-testable without HTTP; this module maps those to routes. The app is
 * created via `app.request()` in tests (no socket needed).
 */

export interface AppDeps {
  reader: DashboardReader;
  media: MediaService;
  /** Repo root that holds data/ (token files) — used by health checks. */
  root: string;
  /** Trigger machinery (Phase 2). Absent → run endpoints return 501. */
  jobs?: JobManager;
  runsStore?: RunsStore;
  /** Tagged image asset library. Absent → asset endpoints return 501. */
  assetsStore?: AssetsStore;
  /** Storage used to save/serve uploaded asset bytes. Absent → uploads 501. */
  storage?: FileStorage;
  /** Vision analyzer run in the background after upload. Absent → no analysis. */
  assetAnalyzer?: AssetAnalyzerPort;
  /** Deploy-time shared token; unset in local dev (open API). */
  authToken?: string;
}

/** What the upload route hands the analyzer. */
export interface AssetAnalysisRequest {
  bytes: Buffer;
  mime: string;
  filename: string;
  tags: string[];
  description: string;
}

/** The slice of @bix/scripts' AssetAnalyzer the server depends on. */
export interface AssetAnalyzerPort {
  analyze(req: AssetAnalysisRequest): Promise<{ analysis: string; tags: string[] }>;
}

/** Actions that spend money / post publicly and therefore require confirmation. */
const SPENDING_KINDS = new Set<RunKind>(["generate", "publish", "orchestrate"]);

/** Which OAuth provider a spending action needs before it can run. */
function requiredProvider(kind: RunKind): string | null {
  switch (kind) {
    case "generate":
      return "higgsfield";
    case "publish":
      return "youtube";
    case "orchestrate":
      return "higgsfield"; // also needs youtube; checked separately below
    default:
      return null;
  }
}

interface RunBody {
  kind?: string;
  slotId?: string;
  provider?: string;
  privacy?: string;
  maxRevisions?: number;
  confirm?: boolean;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const { reader, media, root } = deps;

  // Auth seam: no-op unless a token is configured.
  app.use("/api/*", bearerAuth(deps.authToken));

  // ---- Health ------------------------------------------------------------
  app.get("/api/health", (c) =>
    c.json({ env: envStatus(), oauth: oauthStatus(root) }),
  );

  // ---- Overview (the heart of the UI) ------------------------------------
  app.get("/api/overview", (c) => c.json({ rows: reader.overview() }));

  // ---- Plans + slots -----------------------------------------------------
  app.get("/api/plans", (c) =>
    c.json({ plans: reader.listPlans(), latest: reader.latestPlan() }),
  );
  app.get("/api/plans/:month/slots", (c) =>
    c.json({ slots: reader.listSlots(c.req.param("month")) }),
  );
  app.get("/api/slots/:id", (c) => {
    const detail = reader.getSlotDetail(c.req.param("id"));
    if (!detail) return c.json({ error: "Slot not found" }, 404);
    return c.json(detail);
  });

  // ---- Events ------------------------------------------------------------
  app.get("/api/events", (c) => {
    const scanDate = c.req.query("scanDate");
    return c.json({ events: reader.listEvents(scanDate) });
  });
  app.get("/api/events/scans", (c) => c.json({ scans: reader.listEventScans() }));

  // ---- Scripts / videos / uploads ---------------------------------------
  app.get("/api/scripts/:slotId", (c) => {
    const script = reader.getScript(c.req.param("slotId"));
    if (!script) return c.json({ error: "Script not found" }, 404);
    return c.json(script);
  });
  app.get("/api/videos", (c) => c.json({ videos: reader.listVideoJobs() }));
  app.get("/api/uploads", (c) => c.json({ uploads: reader.listUploads() }));

  // ---- Report text (whitelisted) ----------------------------------------
  app.get("/api/report", (c) => {
    const key = c.req.query("key");
    if (!key) return c.json({ error: "Missing key" }, 400);
    try {
      const { text, contentType } = media.readReport(key);
      return c.body(text, 200, { "Content-Type": contentType });
    } catch (err) {
      return mediaError(c, err);
    }
  });

  // ---- Video with range --------------------------------------------------
  app.get("/api/media/video", (c) => {
    const key = c.req.query("key");
    if (!key) return c.json({ error: "Missing key" }, 400);
    try {
      const { status, headers, body } = media.videoRange(
        key,
        c.req.header("Range"),
      );
      return c.body(body as unknown as ArrayBuffer, status as never, headers);
    } catch (err) {
      return mediaError(c, err);
    }
  });

  // ---- Assets: tagged image library --------------------------------------
  const { assetsStore, storage, assetAnalyzer } = deps;

  app.get("/api/assets", (c) => {
    if (!assetsStore) return c.json({ assets: [] });
    return c.json({ assets: assetsStore.list() });
  });

  app.post("/api/assets", async (c) => {
    if (!assetsStore || !storage) {
      return c.json({ error: "Asset uploads are not enabled on this server." }, 501);
    }
    let form: Record<string, unknown>;
    try {
      form = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid multipart body." }, 400);
    }
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "A 'file' field (image) is required." }, 400);
    }
    const ext = extname(file.name).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      return c.json({ error: "Only .png/.jpg/.jpeg/.webp images are allowed." }, 400);
    }

    const id = randomUUID();
    const safeName = safeFilename(file.name);
    const storagePath = `assets/uploads/${id}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    storage.write(storagePath, bytes);

    const tags = parseTagsField(form.tags);
    const description =
      typeof form.description === "string" ? form.description : "";
    const mime = file.type || "application/octet-stream";
    const record = assetsStore.create({
      id,
      storagePath,
      filename: file.name,
      mime,
      tags,
      description,
      // Mark pending only when a background analyzer will actually run.
      analysisStatus: assetAnalyzer ? "pending" : "",
    });

    // Background (fire-and-forget): analyse the image wrt the project, merge the
    // suggested tags, and store the analysis. The upload responds immediately;
    // the UI polls until analysis_status leaves "pending".
    if (assetAnalyzer) {
      void analyzeAsset(assetAnalyzer, assetsStore, id, {
        bytes,
        mime,
        filename: file.name,
        tags,
        description,
      });
    }

    return c.json({ asset: record }, 201);
  });

  app.patch("/api/assets/:id", async (c) => {
    if (!assetsStore) return c.json({ error: "Assets not enabled." }, 501);
    let body: { tags?: unknown; description?: unknown; enabled?: unknown };
    try {
      body = (await c.req.json()) as { tags?: unknown; description?: unknown; enabled?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }
    const id = c.req.param("id");
    let updated = assetsStore.get(id);
    if (!updated) return c.json({ error: "Asset not found." }, 404);

    if (typeof body.enabled === "boolean") {
      updated = assetsStore.setEnabled(id, body.enabled) ?? updated;
    }
    const fields: { tags?: string[]; description?: string } = {};
    if (body.tags !== undefined) fields.tags = parseTagsField(body.tags);
    if (typeof body.description === "string") fields.description = body.description;
    if (fields.tags !== undefined || fields.description !== undefined) {
      updated = assetsStore.updateTags(id, fields) ?? updated;
    }
    return c.json({ asset: updated });
  });

  app.delete("/api/assets/:id", (c) => {
    if (!assetsStore || !storage) return c.json({ error: "Assets not enabled." }, 501);
    const asset = assetsStore.get(c.req.param("id"));
    if (!asset) return c.json({ error: "Asset not found." }, 404);
    storage.delete(asset.storagePath);
    assetsStore.remove(asset.id);
    return c.json({ ok: true });
  });

  app.get("/api/assets/:id/file", (c) => {
    if (!assetsStore) return c.json({ error: "Assets not enabled." }, 501);
    const asset = assetsStore.get(c.req.param("id"));
    if (!asset) return c.json({ error: "Asset not found." }, 404);
    try {
      const { bytes, contentType } = media.readImage(asset.storagePath);
      return c.body(bytes as unknown as ArrayBuffer, 200, { "Content-Type": contentType });
    } catch (err) {
      return mediaError(c, err);
    }
  });

  // ---- Phase 2: trigger actions -----------------------------------------
  const { jobs, runsStore } = deps;

  app.post("/api/runs", async (c) => {
    if (!jobs || !runsStore) {
      return c.json({ error: "Triggering is not enabled on this server." }, 501);
    }
    let body: RunBody;
    try {
      body = (await c.req.json()) as RunBody;
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const kind = body.kind as RunKind | undefined;
    if (!kind || !["script", "generate", "publish", "orchestrate"].includes(kind)) {
      return c.json({ error: "kind must be script|generate|publish|orchestrate." }, 400);
    }
    if (!body.slotId) {
      return c.json({ error: "slotId is required." }, 400);
    }

    // Guardrail 1: spending actions require explicit confirmation.
    if (SPENDING_KINDS.has(kind) && body.confirm !== true) {
      return c.json(
        { error: `"${kind}" spends credits or posts publicly; resend with confirm: true.` },
        400,
      );
    }

    // Guardrail 2: spending actions require the relevant OAuth token present.
    if (SPENDING_KINDS.has(kind)) {
      const provider = requiredProvider(kind);
      if (provider && !isLoggedIn(provider, root)) {
        return c.json(
          { error: `Needs login: ${provider} token is missing. Run the login command first.` },
          409,
        );
      }
      if (kind === "orchestrate" && !isLoggedIn("youtube", root)) {
        return c.json(
          { error: "Needs login: youtube token is missing (orchestrate publishes)." },
          409,
        );
      }
    }

    // Resolve artefact paths for generate/publish from the DB (read-only).
    const promptFile =
      kind === "generate" ? `outputs/scripts/prompt-${body.slotId}.md` : undefined;
    let file: string | undefined;
    if (kind === "publish") {
      const upload = reader.getUpload(body.slotId);
      const detail = reader.getSlotDetail(body.slotId);
      file = upload?.id ?? detail?.video?.outputPath ?? undefined;
      if (!file) {
        return c.json(
          { error: "No generated video found for this slot to publish." },
          409,
        );
      }
    }

    // For generate/orchestrate, feed the reference images the writer chose (from
    // the stored script) as absolute paths, but drop any the owner has since
    // turned OFF. Empty → the CLI falls back to the default stand image,
    // preserving today's behavior.
    let refs: string[] | undefined;
    if (kind === "generate" || kind === "orchestrate") {
      const script = reader.getScript(body.slotId);
      if (script && script.assetsUsed.length > 0) {
        let keys = script.assetsUsed;
        if (assetsStore) {
          const enabled = new Set(
            assetsStore.list().filter((a) => a.enabled).map((a) => a.storagePath),
          );
          keys = keys.filter((key) => enabled.has(key));
        }
        if (keys.length > 0) refs = keys.map((key) => join(root, key));
      }
    }

    const record = jobs.start(kind, {
      slotId: body.slotId,
      provider: body.provider,
      privacy: body.privacy,
      maxRevisions: body.maxRevisions,
      promptFile,
      refs,
      file,
    });
    return c.json({ runId: record.id, run: record }, 201);
  });

  app.get("/api/runs", (c) => {
    if (!runsStore) return c.json({ runs: [] });
    return c.json({ runs: runsStore.list() });
  });

  app.get("/api/runs/:id", (c) => {
    if (!runsStore) return c.json({ error: "Not found" }, 404);
    const run = runsStore.get(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json(run);
  });

  // Live log + status via SSE.
  app.get("/api/runs/:id/stream", (c) => {
    if (!jobs || !runsStore) {
      return c.json({ error: "Streaming is not enabled." }, 501);
    }
    const id = c.req.param("id");
    const run = runsStore.get(id);
    if (!run) return c.json({ error: "Not found" }, 404);

    return streamSSE(c, async (stream) => {
      // Replay the log captured so far so a late subscriber isn't blank.
      if (run.log) {
        for (const line of run.log.split("\n")) {
          if (line.length > 0) {
            await stream.writeSSE({ event: "log", data: line });
          }
        }
      }
      // If it already finished, send the terminal status and close.
      if (run.status !== "RUNNING") {
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ status: run.status, exitCode: run.exitCode }),
        });
        return;
      }

      // Otherwise subscribe to live events until the run ends.
      await new Promise<void>((resolve) => {
        const unsubscribe = jobs.subscribe(id, (event) => {
          if (event.type === "log") {
            void stream.writeSSE({ event: "log", data: event.line });
          } else {
            void stream
              .writeSSE({
                event: "status",
                data: JSON.stringify({ status: event.status, exitCode: event.exitCode }),
              })
              .then(() => {
                unsubscribe();
                resolve();
              });
          }
        });
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    });
  });

  return app;
}

/**
 * Run the vision analysis and fold the result back into the asset row. Merges
 * the uploader's tags with the model's suggestions (uploader first, de-duped,
 * case-insensitive). Never throws: a failure marks analysis_status = "error" so
 * the upload itself is unaffected.
 */
async function analyzeAsset(
  analyzer: AssetAnalyzerPort,
  assetsStore: AssetsStore,
  id: string,
  req: AssetAnalysisRequest,
): Promise<void> {
  try {
    const { analysis, tags } = await analyzer.analyze(req);
    assetsStore.updateAnalysis(id, {
      analysis,
      tags: mergeTags(req.tags, tags),
      status: "done",
    });
  } catch {
    assetsStore.updateAnalysis(id, { status: "error" });
  }
}

/** Uploader tags first, then any new suggestions; de-duplicated case-insensitively. */
function mergeTags(userTags: string[], suggested: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...userTags, ...suggested]) {
    const trimmed = t.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

function mediaError(c: Context, err: unknown): Response {
  if (err instanceof MediaAccessError) {
    return c.json({ error: err.message }, err.status as never);
  }
  return c.json({ error: "Internal error" }, 500);
}

/** Strip anything but a safe filename charset; keep the extension readable. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return cleaned.length > 0 ? cleaned : "image";
}

/**
 * Accept tags as a JSON array string, a comma-separated string, or an array.
 * Returns a de-duplicated list of non-empty trimmed tags.
 */
function parseTagsField(value: unknown): string[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("[")) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text.split(",");
      }
    } else {
      raw = text.split(",");
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
