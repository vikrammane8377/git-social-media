import { api } from "../api";
import { Chip, ErrorMsg, Loading, useAsync } from "../ui";

export function Health() {
  const { data, error, loading } = useAsync(() => api.health(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;
  if (!data) return null;

  return (
    <div>
      <h1>Health</h1>

      <div className="panel">
        <h2>OAuth logins</h2>
        <p className="muted">
          Whether generate (Higgsfield) and publish (YouTube) will work before you try.
        </p>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Token expires</th>
            </tr>
          </thead>
          <tbody>
            {data.oauth.providers.map((p) => (
              <tr key={p.provider}>
                <td>{p.provider}</td>
                <td>
                  <Chip
                    value={
                      p.loggedIn ? (p.expired ? "EXPIRED" : "LOGGED_IN") : "NOT_LOGGED_IN"
                    }
                  />
                </td>
                <td>{p.expiresAt ? new Date(p.expiresAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Environment keys</h2>
        <p className="muted">Present / missing only — values are never shown.</p>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Status</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {data.env.keys.map((k) => (
              <tr key={k.name}>
                <td>{k.name}</td>
                <td>
                  <Chip value={k.present ? "PRESENT" : "MISSING"} />
                </td>
                <td className="muted">{k.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
