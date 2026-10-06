import { api } from "../api";
import { ErrorMsg, Loading, useAsync } from "../ui";

export function Events() {
  const { data, error, loading } = useAsync(() => api.events(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;

  return (
    <div>
      <h1>Event ideas (kept)</h1>
      {data && data.length === 0 && (
        <p className="muted">No events yet. Run the events scan.</p>
      )}
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Scan</th>
              <th>Event date</th>
              <th>Title</th>
              <th>Fit</th>
              <th>Format</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.scanDate}</td>
                <td>{e.eventDate}</td>
                <td>
                  {e.title}
                  {e.summary && (
                    <>
                      <br />
                      <span className="muted">{e.summary}</span>
                    </>
                  )}
                </td>
                <td>{e.brandFit}</td>
                <td>{e.suggestedFormat ?? "—"}</td>
                <td>
                  {e.sourceUrl ? (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                      {e.source}
                    </a>
                  ) : (
                    e.source
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
