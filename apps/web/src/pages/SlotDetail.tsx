import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { api, type RunKind, type SlotDetail as SlotDetailData } from "../api";
import { Chip, ErrorMsg, Loading, useAsync } from "../ui";

const SPEND: Record<RunKind, string> = {
  script: "Spends OpenAI tokens only (no video credits, no publish).",
  generate: "Spends video credits to render the MP4 (needs provider login).",
  publish: "Uploads the finished MP4 to YouTube (public) — needs YouTube login.",
  orchestrate:
    "Runs script → generate → publish end-to-end. Spends OpenAI tokens AND video credits, then publishes (public).",
};

export function SlotDetail() {
  const { id } = useParams<{ id: string }>();
  const slotId = id ?? "";
  const { data, error, loading, reload } = useAsync(() => api.slot(slotId), [slotId]);

  const [pending, setPending] = useState<RunKind | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;
  if (!data) return <ErrorMsg message="Slot not found" />;

  const { slot, script, video, upload } = data;

  async function trigger(kind: RunKind) {
    setRunError(null);
    const needsConfirm = kind !== "script";
    if (needsConfirm && !window.confirm(`${kind.toUpperCase()}\n\n${SPEND[kind]}\n\nProceed?`)) {
      return;
    }
    try {
      const { runId } = await api.startRun({
        kind,
        slotId,
        confirm: needsConfirm ? true : undefined,
      });
      setActiveRunId(runId);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <h1>
        Slot {slot.id} <Chip value={script?.decision} />
      </h1>

      <div className="actions">
        {(["script", "generate", "publish", "orchestrate"] as RunKind[]).map((kind) => (
          <button
            key={kind}
            className={kind === "orchestrate" ? "primary" : ""}
            disabled={pending !== null}
            onClick={() => trigger(kind)}
            title={SPEND[kind]}
          >
            {label(kind)}
          </button>
        ))}
        <button onClick={reload}>Refresh status</button>
      </div>
      {runError && <ErrorMsg message={runError} />}
      {activeRunId && (
        <LiveLog
          runId={activeRunId}
          onFinished={() => reload()}
          onClose={() => setActiveRunId(null)}
        />
      )}

      <div className="grid2">
        <SlotFields data={data} />
        <MediaPanel video={video} upload={upload} />
      </div>

      {script && <ScriptPanel slotId={slotId} script={script} />}
    </div>
  );
}

function label(kind: RunKind): string {
  switch (kind) {
    case "script":
      return "Run script";
    case "generate":
      return "Generate";
    case "publish":
      return "Publish";
    case "orchestrate":
      return "Orchestrate";
  }
}

function SlotFields({ data }: { data: SlotDetailData }) {
  const { slot } = data;
  return (
    <div className="panel">
      <h2>Slot</h2>
      <dl className="kv">
        <dt>Date / time</dt>
        <dd>
          {slot.slotDate} {slot.slotTime}
        </dd>
        <dt>Format</dt>
        <dd>{slot.format}</dd>
        <dt>Source</dt>
        <dd>{slot.source}</dd>
        <dt>Topic</dt>
        <dd>{slot.topic}</dd>
        <dt>Brand fit</dt>
        <dd>{slot.brandFit}</dd>
        {slot.hook && (
          <>
            <dt>Hook</dt>
            <dd>{slot.hook}</dd>
          </>
        )}
        {slot.why && (
          <>
            <dt>Why</dt>
            <dd>{slot.why}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function MediaPanel({
  video,
  upload,
}: {
  video: SlotDetailData["video"];
  upload: SlotDetailData["upload"];
}) {
  return (
    <div className="panel">
      <h2>Video & publish</h2>
      <dl className="kv">
        <dt>Video status</dt>
        <dd>
          <Chip value={video?.status} />
        </dd>
        <dt>Upload status</dt>
        <dd>
          <Chip value={upload?.status} />
        </dd>
        <dt>YouTube</dt>
        <dd>
          {upload?.url ? (
            <a href={upload.url} target="_blank" rel="noreferrer">
              {upload.url}
            </a>
          ) : (
            <span className="muted">not published</span>
          )}
        </dd>
      </dl>
      {video?.outputPath && (
        <video controls src={api.videoUrl(video.outputPath)} preload="metadata" />
      )}
    </div>
  );
}

function ScriptPanel({ slotId, script }: { slotId: string; script: NonNullable<SlotDetailData["script"]> }) {
  const review = script.review;
  return (
    <div className="panel">
      <h2>Script</h2>
      <dl className="kv">
        {script.title && (
          <>
            <dt>Title</dt>
            <dd>{script.title}</dd>
          </>
        )}
        <dt>Duration</dt>
        <dd>{script.durationSeconds}s</dd>
        <dt>Scene</dt>
        <dd>{script.scenePrompt}</dd>
        <dt>Dialogue</dt>
        <dd>{script.dialogue}</dd>
      </dl>

      {review && (
        <>
          <h2>Reviewer verdict — {review.decision}</h2>
          <dl className="kv">
            <dt>English meaning</dt>
            <dd>{review.englishMeaning}</dd>
            <dt>Brand voice</dt>
            <dd>{review.brandVoice}</dd>
            <dt>Coverage</dt>
            <dd>{review.coverage}</dd>
            <dt>Next step</dt>
            <dd>{review.nextStep}</dd>
          </dl>
          {review.issues.length > 0 && (
            <>
              <h2>Issues</h2>
              <ul>
                {review.issues.map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            </>
          )}
          {review.productClaims.length > 0 && (
            <>
              <h2>Product claims</h2>
              <ul>
                {review.productClaims.map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <ReportBlock title="Script report" reportKey={`outputs/scripts/script-${slotId}.md`} />
      <ReportBlock title="Video prompt" reportKey={`outputs/scripts/prompt-${slotId}.md`} />
    </div>
  );
}

function ReportBlock({ title, reportKey }: { title: string; reportKey: string }) {
  const [text, setText] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .report(reportKey)
      .then((t) => alive && setText(t))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [reportKey]);
  if (missing) return null;
  if (text == null) return null;
  return (
    <>
      <h2>{title}</h2>
      <div className="markdown">
        <Markdown>{text}</Markdown>
      </div>
    </>
  );
}

function LiveLog({
  runId,
  onFinished,
  onClose,
}: {
  runId: string;
  onFinished: () => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("RUNNING");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    setStatus("RUNNING");
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    es.addEventListener("log", (e) => {
      setLines((prev) => [...prev, (e as MessageEvent).data as string]);
    });
    es.addEventListener("status", (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data as string) as { status: string };
        setStatus(s.status);
      } catch {
        /* ignore */
      }
      es.close();
      onFinished();
    });
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [lines]);

  return (
    <div className="panel">
      <h2>
        Run {runId.slice(0, 8)} — <Chip value={status} />
        <button style={{ float: "right" }} onClick={onClose}>
          Close
        </button>
      </h2>
      <div className="logpanel" ref={ref}>
        {lines.join("\n")}
      </div>
    </div>
  );
}
