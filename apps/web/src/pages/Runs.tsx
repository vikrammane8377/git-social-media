import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type RunRecord } from "../api";
import { Chip, ErrorMsg, Loading, useAsync } from "../ui";

export function Runs() {
  const { data, error, loading, reload } = useAsync(() => api.runs(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;

  return (
    <div>
      <h1>Runs</h1>
      <div className="filters">
        <button onClick={reload}>Refresh</button>
      </div>
      {data && data.length === 0 && <p className="muted">No runs triggered yet.</p>}
      {(data ?? []).map((r) => (
        <RunItem key={r.id} run={r} />
      ))}
    </div>
  );
}

function RunItem({ run }: { run: RunRecord }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(run.log);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      // Re-fetch to get the latest log (in case it grew since the list load).
      try {
        const fresh = await api.run(run.id);
        setLog(fresh.log);
      } catch {
        /* keep existing log */
      }
    }
  }

  return (
    <div className="panel">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Chip value={run.status} />
        <strong>{run.kind}</strong>
        {run.slotId && (
          <Link to={`/slots/${run.slotId}`}>{run.slotId}</Link>
        )}
        <span className="muted">{new Date(run.startedAt).toLocaleString()}</span>
        {run.exitCode != null && <span className="muted">exit {run.exitCode}</span>}
        <button style={{ marginLeft: "auto" }} onClick={toggle}>
          {open ? "Hide log" : "Show log"}
        </button>
      </div>
      {open && <div className="logpanel" style={{ marginTop: 12 }}>{log || "(no output)"}</div>}
    </div>
  );
}
