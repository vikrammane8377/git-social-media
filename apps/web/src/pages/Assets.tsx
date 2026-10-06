import { useEffect, useState } from "react";
import { api, type Asset } from "../api";
import { ErrorMsg, Loading, useAsync } from "../ui";

export function Assets() {
  const { data, error, loading, reload } = useAsync(() => api.listAssets(), []);

  // While any asset is still being analysed, poll so the analysis + suggested
  // tags appear without a manual refresh.
  const analyzing = (data ?? []).some((a) => a.analysisStatus === "pending");
  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(() => reload(), 2000);
    return () => clearInterval(timer);
  }, [analyzing, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorMsg message={error} />;

  const assets = data ?? [];

  return (
    <div>
      <h1>Assets</h1>
      <p className="muted">
        Tagged images the script writer can auto-select as video references.
      </p>
      <UploadForm onUploaded={reload} />
      {assets.length === 0 && <p className="muted">No assets yet. Upload one above.</p>}
      <div className="asset-grid">
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("tags", tags);
      form.append("description", description);
      await api.uploadAsset(form);
      setFile(null);
      setTags("");
      setDescription("");
      (e.target as HTMLFormElement).reset();
      onUploaded();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="asset-form panel" onSubmit={submit}>
      <div className="field">
        <label>Image</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="field">
        <label>Tags (comma-separated)</label>
        <input
          type="text"
          value={tags}
          placeholder="product, logo, hero"
          onChange={(e) => setTags(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Description</label>
        <input
          type="text"
          value={description}
          placeholder="Bix bottle on white background"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <button type="submit" className="primary" disabled={!file || busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {err && <ErrorMsg message={err} />}
    </form>
  );
}

/** Shows the vision analysis state: analysing spinner, the text, or a failure. */
function AnalysisBlock({ asset }: { asset: Asset }) {
  if (asset.analysisStatus === "pending") {
    return <div className="asset-analysis muted">AI analysis · analysing…</div>;
  }
  if (asset.analysisStatus === "error") {
    return <div className="asset-analysis muted">AI analysis failed.</div>;
  }
  if (asset.analysis) {
    return (
      <div className="asset-analysis">
        <span className="asset-analysis-label">AI analysis</span>
        <p>{asset.analysis}</p>
      </div>
    );
  }
  return null;
}

function AssetCard({ asset, onChanged }: { asset: Asset; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [description, setDescription] = useState(asset.description);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api.updateAssetTags(asset.id, {
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete "${asset.filename}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteAsset(asset.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function toggleEnabled(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api.setAssetEnabled(asset.id, !asset.enabled);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`asset-card panel${asset.enabled ? "" : " disabled"}`}>
      <img src={api.assetFileUrl(asset.id)} alt={asset.filename} loading="lazy" />
      <div className="asset-body">
        <div className="asset-name" title={asset.filename}>
          {asset.filename}
        </div>
        {editing ? (
          <>
            <div className="field">
              <label>Tags</label>
              <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="asset-actions">
              <button type="button" className="primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTags(asset.tags.join(", "));
                  setDescription(asset.description);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="asset-tags">
              {asset.tags.length > 0 ? (
                asset.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))
              ) : (
                <span className="muted">No tags</span>
              )}
            </div>
            {asset.description && <div className="muted">{asset.description}</div>}
            <AnalysisBlock asset={asset} />
            <div className="asset-actions">
              <button
                type="button"
                className={asset.enabled ? "primary" : ""}
                onClick={toggleEnabled}
                disabled={busy}
                title={
                  asset.enabled
                    ? "On — offered to the writer as a reference"
                    : "Off — excluded from the writer and generation"
                }
              >
                {asset.enabled ? "On" : "Off"}
              </button>
              <button type="button" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button type="button" onClick={remove} disabled={busy}>
                Delete
              </button>
            </div>
          </>
        )}
        {err && <ErrorMsg message={err} />}
      </div>
    </div>
  );
}
