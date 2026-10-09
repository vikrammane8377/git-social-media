import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OverviewRow } from "../api";
import { Chip, ErrorMsg, Loading, useAsync } from "../ui";

const DECISIONS = ["ALL", "PASS", "REVISE", "NEEDS_EVIDENCE", "NONE"];
const STATUSES = ["ALL", "COMPLETED", "IN_PROGRESS", "SUBMITTED", "FAILED", "NONE"];

export function Overview() {
  const { data, error, loading, reload } = useAsync(() => api.overview(), []);
  // Publish defaults drive the privacy each manual run posts with (default public).
  const { data: settings } = useAsync(() => api.settings(), []);
  const privacy = settings?.publishDefaults.privacy ?? "public";
  const [decision, setDecision] = useState("ALL");
  const [videoStatus, setVideoStatus] = useState("ALL");

  const rows = useMemo(() => {
    if (!data) return [];
    return data.filter((r) => {
      const d = r.scriptDecision ?? "NONE";
      const v = r.videoStatus ?? "NONE";
      if (decision !== "ALL" && d !== decision) return false;
      if (videoStatus !== "ALL" && v !== videoStatus) return false;
      return true;
    });
  }, [data, decision, videoStatus]);

  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;

  return (
    <div>
      <h1>Overview — latest plan</h1>
      {data && data.length === 0 && (
        <p className="muted">
          No plan slots yet. Run the competitor scan to build a content plan.
        </p>
      )}
      <div className="filters">
        <label>
          Decision{" "}
          <select value={decision} onChange={(e) => setDecision(e.target.value)}>
            {DECISIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Video{" "}
          <select value={videoStatus} onChange={(e) => setVideoStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button onClick={reload}>Refresh</button>
        <span className="muted">
          {rows.length} of {data?.length ?? 0} slots
        </span>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Date / time</th>
              <th>Channel</th>
              <th>Format</th>
              <th>Topic</th>
              <th>Fit</th>
              <th>Script</th>
              <th>Video</th>
              <th>Upload</th>
              <th>YouTube</th>
              <th>Demo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.slotId} row={r} reload={reload} privacy={privacy} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type DemoState = "idle" | "starting" | "running" | "done" | "error";

function Row({
  row,
  reload,
  privacy,
}: {
  row: OverviewRow;
  reload: () => void;
  privacy: string;
}) {
  const [state, setState] = useState<DemoState>("idle");
  const [lastLine, setLastLine] = useState("");
  const esRef = useRef<EventSource | null>(null);

  // Tear down any open stream when the row unmounts.
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  async function runPipeline(): Promise<void> {
    const ok = window.confirm(
      `Run the full pipeline for this slot?\n\n${row.slotDate} ${row.slotTime} — ${row.topic}\n\n` +
        `This spends real video credits and posts a ${privacy} video to the ${row.channel} channel on YouTube.`,
    );
    if (!ok) return;

    setState("starting");
    setLastLine("");
    try {
      const { runId } = await api.startRun({
        kind: "orchestrate",
        slotId: row.slotId,
        privacy,
        confirm: true,
      });
      setState("running");

      const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
      esRef.current = es;
      es.addEventListener("log", (ev) => {
        const line = (ev as MessageEvent).data as string;
        if (line) setLastLine(line);
      });
      es.addEventListener("status", (ev) => {
        const { status } = JSON.parse((ev as MessageEvent).data as string) as {
          status: string;
        };
        es.close();
        esRef.current = null;
        if (status === "SUCCEEDED") {
          setState("done");
          reload();
        } else {
          setState("error");
        }
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setState("error");
      };
    } catch (err) {
      setLastLine(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  const busy = state === "starting" || state === "running";
  const statusChip =
    state === "running" || state === "starting" ? (
      <Chip value="RUNNING" />
    ) : state === "done" ? (
      <Chip value="SUCCEEDED" />
    ) : state === "error" ? (
      <Chip value="FAILED" />
    ) : null;

  return (
    <tr>
      <td>
        <Link to={`/slots/${row.slotId}`}>
          {row.slotDate}
          <br />
          <span className="muted">{row.slotTime}</span>
        </Link>
      </td>
      <td>
        <Chip value={row.channel} />
      </td>
      <td>{row.format}</td>
      <td>{row.topic}</td>
      <td>{row.brandFit}</td>
      <td>
        <Chip value={row.scriptDecision} />
        {row.scriptRevisions != null && row.scriptRevisions > 0 && (
          <span className="muted"> ×{row.scriptRevisions}</span>
        )}
      </td>
      <td>
        <Chip value={row.videoStatus} />
      </td>
      <td>
        <Chip value={row.uploadStatus} />
      </td>
      <td>
        {row.youtubeUrl ? (
          <a href={row.youtubeUrl} target="_blank" rel="noreferrer">
            watch
          </a>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <div className="demo-cell">
          <button className="primary" onClick={runPipeline} disabled={busy}>
            {busy ? "Running…" : "Run pipeline ▶"}
          </button>
          {statusChip && <div className="demo-status">{statusChip}</div>}
          {lastLine && (
            <div className="demo-line muted" title={lastLine}>
              {lastLine}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
