import { useEffect, useState } from "react";
import {
  api,
  type Channel,
  type ChannelOverrides,
  type PublishDefaults,
  type Settings as SettingsData,
} from "../api";
import { ErrorMsg, Loading, useAsync } from "../ui";

const PRIVACIES = ["public", "unlisted", "private"];

/**
 * Edit the knobs the pipeline already reads. Two homes, one form:
 *  - Publish defaults (privacy/provider/maxRevisions/captions) → server DB.
 *  - Per-channel overrides (label, enabled, posting, persona, metadata …) →
 *    config/channels.json, so spawned CLI runs pick the edits up.
 * The form seeds from the *effective* channels; saving pins those values as
 * overrides. There is no separate "reset to defaults" — clearing channels.json
 * on disk restores shipped defaults.
 */
export function Settings() {
  const { data, error, loading, reload } = useAsync(() => api.settings(), []);
  if (loading) return <Loading />;
  if (error) return <ErrorMsg message={error} />;
  if (!data) return null;
  return <SettingsForm initial={data} onSaved={reload} />;
}

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: SettingsData;
  onSaved: () => void;
}) {
  const [publish, setPublish] = useState<PublishDefaults>(initial.publishDefaults);
  const [channels, setChannels] = useState<Channel[]>(initial.channels);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Re-seed if a reload brings fresh server state.
  useEffect(() => {
    setPublish(initial.publishDefaults);
    setChannels(initial.channels);
  }, [initial]);

  function patchChannel(id: string, patch: Partial<Channel>): void {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const channelOverrides: ChannelOverrides = {};
      for (const c of channels) {
        channelOverrides[c.id] = {
          label: c.label,
          enabled: c.enabled,
          tokenFile: c.tokenFile,
          primaryLanguage: c.primaryLanguage,
          plannerBrief: c.plannerBrief,
          writerPersona: c.writerPersona,
          productFacts: c.productFacts,
          metadata: c.metadata,
          posting: c.posting,
        };
      }
      await api.updateSettings({ publishDefaults: publish, channelOverrides });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Publish defaults</h2>
        <p className="muted">
          Applied when you trigger a run from the dashboard. Privacy also drives
          each slot's “Run pipeline” on the Overview page.
        </p>
        <div className="filters">
          <label>
            Privacy{" "}
            <select
              value={publish.privacy}
              onChange={(e) => setPublish({ ...publish, privacy: e.target.value })}
            >
              {PRIVACIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Provider{" "}
            <input
              type="text"
              placeholder="(pipeline default)"
              value={publish.provider ?? ""}
              onChange={(e) =>
                setPublish({ ...publish, provider: e.target.value.trim() || null })
              }
            />
          </label>
          <label>
            Max revisions{" "}
            <input
              type="number"
              min={0}
              placeholder="(writer default)"
              value={publish.maxRevisions ?? ""}
              onChange={(e) =>
                setPublish({
                  ...publish,
                  maxRevisions: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={publish.captions}
              onChange={(e) => setPublish({ ...publish, captions: e.target.checked })}
            />{" "}
            Captions
          </label>
        </div>
      </div>

      {channels.map((c) => (
        <ChannelPanel key={c.id} channel={c} onChange={(patch) => patchChannel(c.id, patch)} />
      ))}

      <div className="panel">
        <div className="filters">
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {savedAt && <span className="muted">Saved at {savedAt}</span>}
        </div>
        {saveError && <ErrorMsg message={saveError} />}
      </div>
    </div>
  );
}

function ChannelPanel({
  channel,
  onChange,
}: {
  channel: Channel;
  onChange: (patch: Partial<Channel>) => void;
}) {
  return (
    <div className="panel">
      <h2>
        Channel: {channel.label}{" "}
        <span className="muted">({channel.id})</span>
      </h2>

      <div className="filters">
        <label>
          <input
            type="checkbox"
            checked={channel.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />{" "}
          Enabled
        </label>
        <label>
          Label{" "}
          <input
            type="text"
            value={channel.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </label>
        <label>
          Primary language{" "}
          <input
            type="text"
            value={channel.primaryLanguage}
            onChange={(e) => onChange({ primaryLanguage: e.target.value })}
          />
        </label>
      </div>

      <div className="filters">
        <label>
          Posting time{" "}
          <input
            type="text"
            placeholder="13:00"
            value={channel.posting.time}
            onChange={(e) =>
              onChange({ posting: { ...channel.posting, time: e.target.value } })
            }
          />
        </label>
        <label>
          Timezone{" "}
          <input
            type="text"
            placeholder="America/Mexico_City"
            value={channel.posting.timezone}
            onChange={(e) =>
              onChange({ posting: { ...channel.posting, timezone: e.target.value } })
            }
          />
        </label>
      </div>

      <label className="field">
        Planner brief
        <textarea
          rows={3}
          value={channel.plannerBrief}
          onChange={(e) => onChange({ plannerBrief: e.target.value })}
        />
      </label>

      <label className="field">
        Writer persona
        <textarea
          rows={3}
          value={channel.writerPersona}
          onChange={(e) => onChange({ writerPersona: e.target.value })}
        />
      </label>

      <label className="field">
        Product facts (one per line)
        <textarea
          rows={3}
          value={channel.productFacts.join("\n")}
          onChange={(e) => onChange({ productFacts: splitLines(e.target.value) })}
        />
      </label>

      <h3>Metadata</h3>
      <label className="field">
        Description footer
        <textarea
          rows={2}
          value={channel.metadata.descriptionFooter}
          onChange={(e) =>
            onChange({
              metadata: { ...channel.metadata, descriptionFooter: e.target.value },
            })
          }
        />
      </label>
      <div className="filters">
        <label>
          Category ID{" "}
          <input
            type="text"
            value={channel.metadata.categoryId}
            onChange={(e) =>
              onChange({ metadata: { ...channel.metadata, categoryId: e.target.value } })
            }
          />
        </label>
      </div>
      <label className="field">
        Default tags (comma-separated)
        <input
          type="text"
          value={channel.metadata.defaultTags.join(", ")}
          onChange={(e) =>
            onChange({
              metadata: { ...channel.metadata, defaultTags: splitCommas(e.target.value) },
            })
          }
        />
      </label>
    </div>
  );
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitCommas(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
