// Typed fetch helpers for the @bix/server API. Types mirror the server's read
// layer; kept local (no shared build graph) so the SPA stays out of tsc.

export interface KeyStatus {
  name: string;
  component: string;
  purpose: string;
  present: boolean;
}

export interface OAuthProviderStatus {
  provider: string;
  loggedIn: boolean;
  present: boolean;
  expiresAt: string | null;
  expired: boolean;
}

export interface Health {
  env: { keys: KeyStatus[] };
  oauth: { providers: OAuthProviderStatus[] };
}

export interface OverviewRow {
  slotId: string;
  month: string;
  slotDate: string;
  slotTime: string;
  format: string;
  source: string;
  topic: string;
  brandFit: number;
  scriptDecision: string | null;
  scriptRevisions: number | null;
  videoStatus: string | null;
  videoOutputPath: string | null;
  uploadStatus: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
}

export interface ContentPlan {
  month: string;
  startDate: string;
  endDate: string;
  timezone: string;
  createdAt: string;
}

export interface PlanSlot {
  id: string;
  month: string;
  slotDate: string;
  slotTime: string;
  format: string;
  source: string;
  topic: string;
  brandFit: number;
  hook: string | null;
  why: string | null;
  assets: string | null;
  createdAt: string;
}

export interface ReviewResult {
  decision: string;
  englishMeaning: string;
  brandVoice: string;
  issues: string[];
  productClaims: string[];
  coverage: string;
  uncertainty: string;
  nextStep: string;
}

export interface Script {
  slotId: string;
  title: string | null;
  scenePrompt: string;
  dialogue: string;
  durationSeconds: number;
  videoPrompt: string;
  decision: string;
  review: ReviewResult | null;
  revisions: number;
  createdAt: string;
  updatedAt: string;
}

export interface VideoJob {
  id: string;
  provider: string;
  endpoint: string;
  status: string;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Upload {
  id: string;
  slotId: string;
  title: string;
  privacy: string;
  youtubeVideoId: string | null;
  status: string;
  error: string | null;
  url: string | null;
}

export interface SlotDetail {
  slot: PlanSlot;
  script: Script | null;
  video: VideoJob | null;
  upload: Upload | null;
}

export interface EventIdea {
  id: string;
  scanDate: string;
  title: string;
  summary: string | null;
  eventDate: string;
  source: string;
  sourceUrl: string | null;
  country: string | null;
  brandFit: number;
  reason: string | null;
  suggestedFormat: string | null;
}

export interface EventScan {
  scanDate: string;
  count: number;
}

export type AnalysisStatus = "" | "pending" | "done" | "error";

export interface Asset {
  id: string;
  storagePath: string;
  filename: string;
  mime: string;
  tags: string[];
  description: string;
  /** Vision analysis of the image wrt the project ("" until it completes). */
  analysis: string;
  /** "" when no analysis ran; otherwise pending|done|error. */
  analysisStatus: AnalysisStatus;
  /** When false the asset is kept but excluded from the writer and generation. */
  enabled: boolean;
  createdAt: string;
}

export type RunKind = "script" | "generate" | "publish" | "orchestrate";
export type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface RunRecord {
  id: string;
  kind: RunKind;
  slotId: string | null;
  argsJson: string;
  status: RunStatus;
  exitCode: number | null;
  log: string;
  startedAt: string;
  endedAt: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<Health>("/api/health"),
  overview: () => getJson<{ rows: OverviewRow[] }>("/api/overview").then((r) => r.rows),
  plans: () =>
    getJson<{ plans: ContentPlan[]; latest: ContentPlan | null }>("/api/plans"),
  slots: (month: string) =>
    getJson<{ slots: PlanSlot[] }>(`/api/plans/${encodeURIComponent(month)}/slots`).then(
      (r) => r.slots,
    ),
  slot: (id: string) => getJson<SlotDetail>(`/api/slots/${encodeURIComponent(id)}`),
  events: (scanDate?: string) =>
    getJson<{ events: EventIdea[] }>(
      `/api/events${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`,
    ).then((r) => r.events),
  eventScans: () => getJson<{ scans: EventScan[] }>("/api/events/scans").then((r) => r.scans),
  runs: () => getJson<{ runs: RunRecord[] }>("/api/runs").then((r) => r.runs),
  run: (id: string) => getJson<RunRecord>(`/api/runs/${encodeURIComponent(id)}`),

  reportUrl: (key: string) => `/api/report?key=${encodeURIComponent(key)}`,
  videoUrl: (key: string) => `/api/media/video?key=${encodeURIComponent(key)}`,

  async report(key: string): Promise<string> {
    const res = await fetch(api.reportUrl(key));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },

  async startRun(body: {
    kind: RunKind;
    slotId: string;
    provider?: string;
    privacy?: string;
    maxRevisions?: number;
    confirm?: boolean;
  }): Promise<{ runId: string; run: RunRecord }> {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      runId?: string;
      run?: RunRecord;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    }
    return { runId: data.runId as string, run: data.run as RunRecord };
  },

  listAssets: () => getJson<{ assets: Asset[] }>("/api/assets").then((r) => r.assets),

  assetFileUrl: (id: string) => `/api/assets/${encodeURIComponent(id)}/file`,

  async uploadAsset(form: FormData): Promise<Asset> {
    const res = await fetch("/api/assets", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as { asset?: Asset; error?: string };
    if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    return data.asset as Asset;
  },

  async updateAssetTags(
    id: string,
    fields: { tags?: string[]; description?: string },
  ): Promise<Asset> {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = (await res.json().catch(() => ({}))) as { asset?: Asset; error?: string };
    if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    return data.asset as Asset;
  },

  async setAssetEnabled(id: string, enabled: boolean): Promise<Asset> {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = (await res.json().catch(() => ({}))) as { asset?: Asset; error?: string };
    if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
    return data.asset as Asset;
  },

  async deleteAsset(id: string): Promise<void> {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
    }
  },
};
