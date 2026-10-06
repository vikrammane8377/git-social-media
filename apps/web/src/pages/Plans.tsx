import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { api } from "../api";
import { ErrorMsg, Loading, useAsync } from "../ui";

export function Plans() {
  const { data, error, loading } = useAsync(() => api.plans(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;

  const plans = data?.plans ?? [];
  return (
    <div>
      <h1>Content plans</h1>
      {plans.length === 0 && (
        <p className="muted">No plans yet. Run the competitor scan.</p>
      )}
      {plans.map((p) => (
        <div className="panel" key={p.month}>
          <h2>
            {p.month}{" "}
            <span className="muted">
              ({p.startDate} → {p.endDate}, {p.timezone})
            </span>
          </h2>
          <PlanReport month={p.month} />
        </div>
      ))}
    </div>
  );
}

function PlanReport({ month }: { month: string }) {
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    // Competitor scan writes the plan report under outputs/plans/.
    api
      .report(`outputs/plans/plan-${month}.md`)
      .then((t) => alive && setText(t))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [month]);

  if (missing) return <p className="muted">No rendered plan markdown found for {month}.</p>;
  if (text == null) return <Loading />;
  return (
    <div className="markdown">
      <Markdown>{text}</Markdown>
    </div>
  );
}
