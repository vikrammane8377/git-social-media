import {
  loadChannels,
  readChannelOverrides,
  writeChannelOverrides,
  type ChannelConfig,
  type ChannelOverrides,
} from "@bix/config";
import type { Database } from "@bix/storage";

/**
 * Dashboard-editable settings. Two kinds live here with different homes:
 *
 *  - **Publish defaults** (privacy / provider / maxRevisions / captions) are
 *    server-only UI state, stored in a small `settings` key/JSON table in the
 *    same `data/bix.db` the rest of the dashboard uses.
 *  - **Channel overrides** (label, enabled, posting, persona, metadata …) are
 *    written straight to `config/channels.json` — the override layer every
 *    pipeline stage already reads via `@bix/config`'s loader. Persisting there
 *    (not only in the DB) is what lets spawned CLI runs pick the edits up.
 *
 * This keeps a single server-facing settings object while routing each kind to
 * the home that makes it effective; there is no duplicate source of truth.
 */

/** Global publish defaults the dashboard applies when triggering a run. */
export interface PublishDefaults {
  /** YouTube privacy: public | unlisted | private. */
  privacy: string;
  /** Video provider override; null = use the pipeline's configured default. */
  provider: string | null;
  /** Auto-revision cap override; null = use the script writer's default. */
  maxRevisions: number | null;
  /** Whether OpusClip captioning runs before publishing. */
  captions: boolean;
}

const PRIVACIES = new Set(["public", "unlisted", "private"]);

const DEFAULT_PUBLISH: PublishDefaults = {
  privacy: "public",
  provider: null,
  maxRevisions: null,
  captions: true,
};

const PUBLISH_KEY = "publishDefaults";

/** Coerce an arbitrary object into a valid {@link PublishDefaults}. */
function normalizePublish(input: Partial<PublishDefaults> | undefined): PublishDefaults {
  const privacy =
    typeof input?.privacy === "string" && PRIVACIES.has(input.privacy)
      ? input.privacy
      : DEFAULT_PUBLISH.privacy;
  const provider =
    typeof input?.provider === "string" && input.provider.trim().length > 0
      ? input.provider.trim()
      : null;
  const maxRevisions =
    typeof input?.maxRevisions === "number" && Number.isFinite(input.maxRevisions)
      ? Math.max(0, Math.trunc(input.maxRevisions))
      : null;
  const captions = typeof input?.captions === "boolean" ? input.captions : DEFAULT_PUBLISH.captions;
  return { privacy, provider, maxRevisions, captions };
}

export class SettingsStore {
  constructor(
    private readonly db: Database,
    /** Repo `config/` dir that holds channels.json. */
    private readonly configDir: string,
  ) {}

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  getPublishDefaults(): PublishDefaults {
    const row = this.db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [PUBLISH_KEY],
    );
    if (!row) return { ...DEFAULT_PUBLISH };
    try {
      return normalizePublish(JSON.parse(row.value) as Partial<PublishDefaults>);
    } catch {
      return { ...DEFAULT_PUBLISH };
    }
  }

  setPublishDefaults(input: Partial<PublishDefaults>): PublishDefaults {
    const next = normalizePublish({ ...this.getPublishDefaults(), ...input });
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [PUBLISH_KEY, JSON.stringify(next)],
    );
    return next;
  }

  /** The raw per-channel overrides currently stored in config/channels.json. */
  getChannelOverrides(): ChannelOverrides {
    return readChannelOverrides(this.configDir);
  }

  /** Persist per-channel overrides so both the dashboard and CLI runs see them. */
  setChannelOverrides(overrides: ChannelOverrides): void {
    writeChannelOverrides(this.configDir, overrides);
  }

  /** The effective channels (defaults <- channels.json), for display. */
  resolvedChannels(): ChannelConfig[] {
    return loadChannels(this.configDir);
  }
}
