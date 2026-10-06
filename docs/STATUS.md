# Bix Social Console - Status

Last updated: 2026-09-30

## What works

**Component 0: Skeleton** - done.

- TypeScript monorepo using npm workspaces:
  - `packages/config` (`@bix/config`) - config loader.
  - `packages/storage` (`@bix/storage`) - SQLite + local file storage.
  - `packages/video` (`@bix/video`) - video provider adapter + resumable runner.
  - `apps/cli` (`@bix/cli`) - command-line entry point.
  - `docs/` - roadmap, spec and this status file.
- Git initialised.
- Config loader reads `.env` (via `dotenv`) and reports each known key as
  present/missing. Values are never printed, logged or returned by the check.
- `.env.example` lists key names only.
- SQLite behind a small `Database` interface (`SqliteDatabase`, using Node's
  built-in `node:sqlite`), swappable for PostgreSQL later.
- Local file storage behind a `FileStorage` interface (`LocalFileStorage`),
  swappable for Cloud Storage later.

**Component 1: Video generation (fal Seedance 2.5)** - done; verified end-to-end
against the live fal API (real MP4 produced, resumability confirmed).

- Provider adapter (`VideoProvider`) so the provider can be swapped later.
  `FalSeedanceProvider` uses the official `@fal-ai/client` and the standard
  endpoint `bytedance/seedance-2.5/reference-to-video` (not the `/us/` variant).
  Endpoint id and input/output fields confirmed from fal's official API schema.
- Flow: upload reference image(s) -> submit -> **save the request id to SQLite
  immediately** -> poll status -> download the MP4 to local storage.
- Resumable: reruns compute the same deterministic job id from the inputs
  (prompt + params + reference-image content), so an interrupted job resumes the
  saved request instead of submitting a new one. Proven by an automated restart
  test that reopens the DB from disk.
- Defaults for the first test: 720p, 9:16, 5s, `generate_audio: true`.
- Never asks the model for on-screen text/captions/signs (stated in the prompt).

**Component 1b: Talking mascot (fal AI Avatar single-text)** - done; verified
end-to-end against the live fal API (real talking MP4 produced, voice generated
by the model from text, resumability confirmed). Needs `FAL_KEY`.

- Second `VideoProvider`, `FalAvatarSingleTextProvider`, endpoint
  `fal-ai/ai-avatar/single-text`. One call: still image + a line of text ->
  the model synthesises the voice (one of 20 built-in voices) AND lip-syncs it.
  There is no separate audio file / TTS step (per owner: "let the video model
  only generate the voice"). Fields confirmed from fal's official API schema:
  `image_url`, `text_input`, `voice`, `prompt`, `num_frames` (41-721, default
  145 ~5.8s at 25fps), `resolution` (480p or 720p only).
- Note: **the Kling AI Avatar v2 models are audio-driven** (require an
  `audio_url`); they lip-sync supplied audio and do NOT generate a voice, so
  they do not fit "model generates the voice". single-text was chosen instead.
- CLI: `--provider avatar` selects it; `--script`/`--script-file` (the line),
  `--voice` (e.g. Will, Bill, Aria), `--frames`. `--prompt-file` still supplies
  the scene/motion prompt (no on-screen text). Seedance stays the default.
- Constraint learned from a live 422: the generated **speech must be at least as
  long as the video** (`num_frames`/25 s). A too-short line fails with
  "Audio is too short ... must be at least N.NNs". Use a longer line or fewer
  frames. fal's validation detail is now surfaced (was a bare "Unprocessable
  Entity") via `falErrorMessage`.
- Price (fal): **$0.2/sec at 480p, $0.4/sec at 720p** - higher than a silent
  clip because it also synthesises the voice. This model is **much slower** than
  Seedance: the first real talking test took ~35 min server-side to render.
- First real run (2026-09-29): `assets/bix_stand.png` + a witty "Responde a Bix"
  line, voice Will, 480p, 145 frames -> `outputs/video/talking-test-01-*.mp4`
  (670 KB, ~5.8s). Resumability confirmed: the long render was resumed and
  downloaded on a rerun. Estimated cost ~$1.16 (5.8s x $0.20); confirm on the
  fal dashboard.

**Component 1c: Higgsfield MCP path + Wan 3.0 (now the DEFAULT video model)** -
done; verified end-to-end against the live Higgsfield MCP server (real talking
MP4s produced at 720p and 1080p, resumability confirmed through the CLI runner).

- New package `packages/higgsfield` (`@bix/higgsfield`): an MCP client for
  Higgsfield's hosted server at `https://mcp.higgsfield.ai/mcp` using
  `@modelcontextprotocol/sdk` (`StreamableHTTPClientTransport`). Exposes
  `connect`, `listTools`, `callTool`. The server offers 108 tools.
- **OAuth (Clerk), owner-driven**: authorization_code + PKCE with a loopback
  server on port 4123; `offline_access` scope yields a refresh token so the
  access token (~24h) refreshes silently. Tokens are stored ONLY in
  `data/higgsfield-tokens.json` (git-ignored, chmod 0600) - never printed or
  committed. Login: `npm run higgsfield -- login`. The device-code grant is not
  available for dynamically-registered clients, hence the PKCE redirect flow.
- **Billing is different from fal**: the MCP path spends the owner's Higgsfield
  subscription **plan credits** (account plan "max"), NOT a fal per-second dollar
  fee. `balance` reads credits; `generate_video` with `get_cost: true` previews a
  job's credit cost without submitting.
- Video flow (all via MCP tools): `media_upload` -> PUT bytes to the returned
  signed URL -> `media_confirm` -> `generate_video` -> poll `job_status` ->
  download the `rawUrl` MP4. The reference image is the first frame
  (`start_image` role); dialogue is spoken from the prompt; `generate_audio`
  yields a native audio track.
- **Wan 3.0** (`wan3_0`) is the chosen model and the CLI default provider. Model
  contract confirmed live from `models_explore`: duration 2-30s (whole seconds),
  resolution 480p/720p/1080p, `generate_audio` default true, native audio,
  aspect auto/16:9/9:16/1:1/4:3/3:4, no `mode` param. Verified credit costs
  (matched the balance delta exactly): **30s@720p = 52.5, 30s@1080p = 105**.
- Why Wan won a three-way live bake-off (all 30s, same script + Bix reference):
  - `wan3_0` 720p = 52.5 credits (~40 MB) and 1080p = 105 credits (~86 MB),
    highest quality per credit.
  - `seedance_2_5` needed `mode: "omni_reference"` to accept a reference image;
    30s omni+audio cost **252.35** credits (~8.5 MB) - ~4.8x Wan's price.
  - `gemini_omni` caps at 10s (8s = 24 credits) - too short for the format.
- Integrated into the existing `VideoProvider`/`VideoRunner` framework as
  `HiggsfieldWanProvider` (in `@bix/video`), so resume/job-store machinery is
  unchanged. Two live-learned quirks are handled in the provider:
  - The server sometimes returns a **`preset_recommendation` notice instead of
    creating a job** when a prompt resembles a built-in preset. The provider
    always wants the literal prompt, so it retries once with `declined_preset_id`.
  - Early job status is reported as **`queued`** (mapped to IN_QUEUE alongside
    `pending`); `in_progress`->IN_PROGRESS, `completed`->COMPLETED, anything else
    (e.g. `failed`, `ip_detected`) is fatal.
- CLI: `--provider wan` (now the default). `--provider seedance|avatar|veo|kling`
  still select the fal providers. A generic `npm run higgsfield -- call <tool>
  <json|@file>` subcommand exists for ad-hoc MCP calls (`@file` avoids shell
  quoting issues with prompts).
- Tests: 10 unit tests for `HiggsfieldWanProvider` (param mapping, preset-decline
  retry, duration validation, status mapping incl. `queued`, result parsing) with
  `callTool` mocked. Full suite green (88 tests).

**Component 2: Weekly current-events scan** - done; run once for real against
the live OpenAI API. Needs `OPENAI_API_KEY` (present).

- New package `packages/events` (`@bix/events`).
- Three sources, merged and de-duplicated before scoring:
  - **OpenAI web search** via the Responses API with the built-in
    `{ type: "web_search" }` tool. Behind an `EventSearchProvider` adapter so it
    can be swapped later (e.g. Grok). Every returned topic MUST include a real
    `http(s)` source URL and a valid in-window date; anything missing either is
    discarded so the model can never invent an event.
  - **Public-holiday API** (Nager.Date, free/keyless) via the v3
    `PublicHolidays/{year}/{country}` endpoint for MX, CO, ES, AR, US, GB. Base
    URL is in config so it can be pointed elsewhere. Returns local (Spanish) and
    English names.
  - **Curated calendar** (`config/curated-calendar.json`, owner-editable):
    Halloween, Día de Muertos, Thanksgiving, Christmas, Women's World Cup 2027
    draw. Edit this file to add/remove entries.
- OpenAI scores each surviving topic 0-10 for brand fit (Español workspace), with
  a one-line reason, a suggested format, and a posting window.
- **Blocklist runs before AND after scoring**: built-in categories (death,
  disaster, tragedy, war, crime, politics, health scares) plus config keywords
  (`config/events-scan.json`). Blocked topics are listed with the reason. Errs
  toward caution.
- Output: kept ideas saved to SQLite (`event_ideas`) plus a readable report at
  `outputs/scans/events-YYYY-MM-DD.md` showing kept and blocked topics.
- Settings in `config/events-scan.json` (model default `gpt-5.6`, `weeksAhead` 6,
  country lists, holiday API base URL, extra blocklist keywords).
- First real run (2026-09-29): 35 web + 107 holiday topics -> 44 in window -> 40
  kept, 4 blocked. Known follow-up (deferred by owner): blocklist substring
  matching over-blocks some celebratory/cultural items (e.g. Día de Muertos hit
  by "dead"). Precision fix (word boundaries + allowlist) is parked for later.

**Component 3: Monthly competitor scan -> 30-day content plan** - done; run once
for real (2026-09-29) against live YouTube + OpenAI. `YOUTUBE_API_KEY` and
`OPENAI_API_KEY` both present.

- New package `packages/competitors` (`@bix/competitors`).
- **YouTube Data API v3** adapter (`YouTubeClient`, key only, no OAuth) reads
  each tracked channel's recent Shorts: resolves the channel (`channels.list` by
  `@handle` or id) to its uploads playlist, pages `playlistItems.list` for recent
  video ids, then `videos.list` for title/publishedAt/duration/view-like-comment
  counts. Avoids `search.list` (100 quota units) to respect quota. Shorts are
  filtered by duration (`maxShortSeconds`, default 180s). Base URL is in config.
  Field shapes follow the documented v3 contract but are **unverified against a
  live key** (no key yet).
- **GPT-6 Astra** is the model (confirmed from the owner-supplied model docs:
  Responses API, web search and structured outputs supported, text+image in).
  "medium mode" = `reasoning.effort: "medium"` (confirmed against the installed
  SDK types). The SDK is wired only in `openai-client.ts` (`createAstraClient`);
  the rest of the package codes against a tiny `LlmClient` so it stays testable.
- The analyst (`OpenAiCompetitorAnalyst`) summarises patterns only - formats,
  hooks, lengths, posting rhythm, themes, CTAs - and is told never to copy
  scripts. The report always carries the caveat that public counts cannot show
  organic vs paid reach or audience nationality.
- The planner (`OpenAiPlanGenerator`) builds a 30-day plan combining competitor
  insights + the latest events scan (read from the `event_ideas` table via
  `LatestEventsReader`, upcoming only) + evergreen formats + the configured
  cadence/format mix. Every returned slot is validated: date must be inside the
  window and source must be event/competitor/evergreen, else it is dropped.
- Each slot: date, posting time (Mexico City TZ by default), format, source,
  topic, brand-fit, hook in Bix's voice, why it's in the plan, assets needed.
- A channel that fails to resolve is recorded in `unresolved` and skipped; the
  scan does not fail as a whole.
- Output: plan saved to SQLite (`content_plans`, `plan_slots`) plus
  `outputs/plans/plan-YYYY-MM.md` (readable) and `plan-YYYY-MM.json`.
- Settings in `config/competitor-scan.json` (model `gpt-6-astra`,
  `reasoningEffort` `medium`, YouTube base URL, channel list with weights,
  `maxVideosPerChannel`, `maxShortSeconds`, `planDays`, cadence + format mix,
  evergreen formats).
- Per-run cost reporting: the OpenAI client is wrapped in `UsageTrackingClient`,
  which sums `response.usage` tokens across calls. The CLI prints actual dollars
  at the run's end using owner-editable `pricing` in `config/competitor-scan.json`
  (default $10/1M input, $50/1M output, from the GPT-6 Astra docs). Web-search
  calls add a per-call fee that OpenAI bills separately - flagged but not summed
  (its exact amount is not in our code; check the OpenAI dashboard).
- Channel handles in config are **unconfirmed placeholders**. First real run
  (2026-09-29): only **Busuu** resolved (`@busuu`, 60,800 subs, 30 Shorts);
  Duolingo Spanish (`@duolingospanish`), Praktika (`@praktika_ai`) and Falou
  (`@falou_app`) did NOT resolve and were skipped. The scan still produced a
  22-slot plan; confirm the real handles/IDs for the other three to widen the
  competitor sample. Run cost: 2 OpenAI calls, 9,873 in + 6,750 out tokens =
  $0.44 token cost (plus the separate web-search fee).

**Component 5: Publish generated video to YouTube** - built; unit-tested. Needs
the owner's Google Desktop OAuth client (see Keys) before the first live upload.

- New package `packages/youtube` (`@bix/youtube`), mirroring the `@bix/higgsfield`
  (OAuth) and `@bix/video` (store/runner) style. Raw `fetch`, no `googleapis`.
  Deps: `@bix/config`, `@bix/storage`.
- **OAuth (Google, owner-driven)**: authorization_code + PKCE (S256) with a
  loopback server on port **4124** (Higgsfield uses 4123). Google does NOT
  support dynamic client registration, so the owner creates a **Desktop app**
  OAuth client in the Google Cloud Console, enables **YouTube Data API v3**, and
  puts `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` in `.env` (public-client
  creds; PKCE is the real protection, but Google still requires the secret on the
  token endpoint). `access_type=offline` + `prompt=consent` guarantee a refresh
  token so the ~1h access token refreshes silently. Scope
  `https://www.googleapis.com/auth/youtube.upload`. Tokens are stored ONLY in
  `data/youtube-tokens.json` (git-ignored, chmod 0600) - never printed/committed.
  Login: `npm run youtube -- login`.
- **Upload** is the resumable, two-phase Data API v3 protocol: (1) POST to
  `.../upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with
  the JSON snippet+status body and `X-Upload-Content-Type/Length` headers -> the
  response's `Location` header is the session URI; (2) PUT the full MP4 bytes to
  that URI -> `201 Created` with the video resource, whose `id` yields
  `https://youtu.be/<id>`. A single PUT of the whole file is fine at our sizes
  (33-86 MB). Google's own error body is surfaced on any non-2xx (no fake
  success).
- **Metadata comes from the content plan** (`plan_slots`, Component 3), read via
  `PlanSlotReader` (mirrors `LatestEventsReader`; missing table -> undefined/[]).
  `slotToMetadata` maps a slot to title (hook || topic, clamped 100), description
  (topic/hook/why + a standard footer, clamped 5000), tags (format + source +
  topic words, de-duped, clamped to 500 total chars), `categoryId` (default
  **"27" Education**), `privacyStatus` (default **public**) and
  `containsSyntheticMedia` (**true** - AI-content disclosure). Any field is
  overridable from the CLI.
- **Idempotent**: `youtube_uploads` table keyed by the video's storage key. If a
  COMPLETED row with a `youtube_video_id` already exists for the file, the upload
  is skipped and the existing URL is printed - no double-posting on reruns.
- **CLI**: a standalone `youtube` command (`login` | `status` | `upload`) AND a
  `--publish` flag on `video`:
  - `npm run youtube -- upload --file <mp4> [--slot <id> | --date <YYYY-MM-DD>]
    [--title ...] [--description-file <path>] [--tags a,b,c]
    [--privacy public|unlisted|private] [--category <id>]
    [--no-synthetic-disclosure]`. `--date` defaults to today; if a date matches
    more than one slot it errors and asks for `--slot`.
  - `npm run video -- ... --publish --slot <id> [--privacy unlisted]` generates,
    then uploads in one pass (requires `--slot`/`--date`, validated before
    generating). The shared `publishFile(...)` in `apps/cli/src/youtube.ts` backs
    both paths.
- Tests: `metadata.test.ts` (mapping + clamping), `upload.test.ts` (mocked fetch:
  initiate -> Location -> PUT -> 201 -> id, plus error surfacing), `upload-store.test.ts`
  (idempotency), `plan-slot-reader.test.ts` (in-memory SQLite: by id, by date,
  missing table). Full suite green (111 tests).
- **Privacy defaults to public** per the decision, but recommend the first live
  upload use `--privacy unlisted` to confirm one real post before relying on the
  public default.

**Component 4: Script writer + AI language reviewer** - built; unit-tested. Turns
a stored content-plan slot into a spoken script and a generation-ready video
prompt, gated by an AI reviewer BEFORE any video money is spent. Needs
`OPENAI_API_KEY` (present).

- New package `packages/scripts` (`@bix/scripts`), mirroring `@bix/competitors`
  exactly: its own tiny `LlmClient` plumbing (`llm.ts`, copied so the package
  stays low-coupled and testable), with the real SDK wired only at the edge in
  `openai-client.ts` (`createSolClient`). Deps: `@bix/config`, `@bix/storage`,
  `openai@^7.23.0`.
- **GPT-5.6 Sol for both the writer and the reviewer** (per the owner's choice).
  "medium mode" = `reasoning.effort: "medium"`. No web-search tool is used here.
- The writer (`OpenAiScriptWriter`) turns one `plan_slots` slot (read via
  `PlanSlotReader`, copied from `@bix/youtube`) into a `ScriptDraft` in Bix's
  witty, mischievous voice: Spanish for LatAm + Spain teaching English, honouring
  the slot's format/topic/hook/why. `revise(...)` re-prompts with the reviewer's
  issues. Malformed JSON is handled (empty draft carrying the raw text) so a run
  never crashes and the reviewer still gates it.
- The reviewer (`OpenAiScriptReviewer`) applies the AI-language-reviewer spec
  (teaching accuracy, false friends, locale, product claims, brand voice) and
  returns a strict-JSON `ReviewResult`. The decision is exactly one of
  **PASS / REVISE / NEEDS_EVIDENCE** — never "PASS WITH CHANGES". An unparseable
  or unknown decision is treated as NEEDS_EVIDENCE (never an optimistic pass).
- The run loop (`runScriptWriter`): write → review → while REVISE and under the
  cap: revise → review again. **Auto-revises up to 2×** (configurable), then
  stops. PASS is a success; REVISE-exhausted or NEEDS_EVIDENCE is reported as
  not-ready (the CLI exits non-zero). `composeVideoPrompt` composes the exact
  two-paragraph prompt `npm run video` expects (dialogue embedded for
  wan/veo/kling; scene-only for avatar). The script is persisted to SQLite via
  `ScriptStore` (`scripts` table, keyed by `slot_id`, INSERT OR REPLACE so reruns
  never duplicate).
- **This component spends OpenAI tokens ONLY.** It never calls a video provider,
  so it cannot burn Higgsfield/FAL credits. On PASS it writes a drop-in prompt
  file for `npm run video`; generation stays a separate, human-in-the-loop step.
- CLI: `npm run script -- --slot <id>` (or `--date <YYYY-MM-DD>`, which errors if
  a date is ambiguous). `--provider wan|avatar|veo|kling|seedance` (default from
  config), `--max-revisions <n>` override. Writes
  `outputs/scripts/script-<slotId>.md` (report) and, on PASS,
  `outputs/scripts/prompt-<slotId>.md`; prints the exact `npm run video` command
  to run next and the run's OpenAI cost.
- Settings in `config/script-writer.json` (owner-editable): `model`,
  `reasoningEffort`, `maxRevisions`, placeholder `pricing`, `video` defaults, and
  the `productFacts` guardrails the reviewer enforces (no fluency-deadline /
  guaranteed-results claims, no free/unlimited claims, "Talk with Bix" is Ultra,
  no on-screen text/captions, vertical 9:16).
- Tests: `prompt.test.ts`, `writer.test.ts`, `reviewer.test.ts`, `run.test.ts`
  (PASS first try = 0 revisions; REVISE→PASS = 1; REVISE×3 stops at the cap and
  reports not-ready), `store.test.ts`, `config.test.ts`, `plan-slot-reader.test.ts`.
  Full suite green (135 tests).

**Component 6: Orchestrator (one slot, end-to-end)** - built. Chains a single
plan slot through script+review → generate → publish in one command. Pure glue
over `@bix/scripts`, `@bix/video` and the shared `publishFile`; no new package.

- Runs ONE slot at a time (`--slot <id>` or `--date`, ambiguous date errors).
- **Phase 1 — script + review gate** (spends OpenAI tokens only): reuses
  `runScriptWriter` exactly as `npm run script` does, writes
  `outputs/scripts/script-<slotId>.md`, prints the decision + OpenAI cost.
- **Gate:** if the reviewer does NOT PASS, it stops here — no video generated, no
  credits spent — and exits non-zero (matching Component 4's money-gate).
- **Phase 2 — generate** (spends video credits): on PASS it writes the drop-in
  `outputs/scripts/prompt-<slotId>.md`, then generates via `VideoRunner` with the
  chosen provider (default from config: Wan), the config's resolution/aspect/audio
  and the draft's duration. Default `--ref` is `assets/bix_stand.png`. Resumable
  through the same job store — rerun to resume an in-flight job.
- **Phase 3 — publish**: uploads the finished MP4 to YouTube via `publishFile`
  with **`--privacy unlisted` by default** and the AI-content disclosure on; the
  owner flips to public manually. Idempotent (skips if already uploaded). If
  generation succeeds but publish fails, it prints the exact
  `npm run youtube -- upload ...` retry line and exits non-zero.
- CLI: `npm run orchestrate -- --slot <id>` with `--provider`, `--ref` (repeatable),
  `--privacy`, `--max-revisions`, `--help`. Requires `OPENAI_API_KEY`, the video
  provider's login (Higgsfield for Wan) and `npm run youtube -- login`.
- No new tests: the phases are already covered by `@bix/scripts`, `@bix/video`
  and `@bix/youtube` unit suites; the command is thin sequencing over them.

**Component 7: Pipeline dashboard (web frontend + API)** - built; unit-tested.
A local-first web app to **see everything** in the pipeline and **trigger**
per-slot actions, architected so it can be deployed later (auth + storage seams
present now). Two new workspaces: a backend `@bix/server` and a Vite+React SPA
`apps/web`.

- New package `packages/server` (`@bix/server`): a **Hono** app (`@hono/node-server`,
  `streamSSE` for live logs). Deps `@bix/config`, `@bix/storage`. Only `@bix/server`
  joins the `tsc --build` graph; `apps/web` is built by Vite, kept out of the tsc
  project references and the vitest include.
- **Read layer** (`DashboardReader`, `src/read.ts`) queries the six existing tables
  through the `Database` interface with **read-only SQL** — no changes to any existing
  package or store. It loads `sqlite_master` first so a missing/partial table yields
  empty results instead of throwing. The heart is `overview()`: one row per slot in
  the latest plan, LEFT JOINed to its script decision (`scripts.slot_id = plan_slots.id`),
  its upload (`youtube_uploads.slot_id = plan_slots.id`) and its video job
  (`video_jobs.output_path = youtube_uploads.id`), plus a `youtu.be/<id>` link.
- **Health** (`src/health.ts`): `envStatus` reuses `checkKeys()` (present/missing only,
  values never returned); `oauthStatus` reports whether `data/youtube-tokens.json` /
  `data/higgsfield-tokens.json` exist and parse and whether they are expired — so the
  UI can show whether generate/publish will work before the user tries. No secret is
  ever sent to the browser.
- **Media** (`src/media.ts`): `readReport` whitelists `.md`/`.json` under `outputs/`;
  `videoRange` serves MP4s (10-86 MB) with **HTTP range** (206 slice / 200 full / 416
  unsatisfiable) so `<video>` can stream previews. Both are path-guarded through
  `LocalFileStorage` (rejects anything outside `outputs/` or with `..`).
- **Triggering reuses the exact CLI** (`JobManager`, `src/jobs.ts`): `start(kind,opts)`
  spawns the CLI as a child process (dev: `npx tsx apps/cli/src/index.ts …`; prod:
  `node apps/cli/dist/index.js …`), captures stdout/stderr line-by-line into the run's
  log and pushes each line to SSE subscribers, then records SUCCEEDED/FAILED + exit code.
  No pipeline logic is duplicated; process isolation + WAL keep it concurrency-safe.
  `buildCliArgs` maps script→`script --slot`, generate→`video --provider wan --prompt-file …
  --ref assets/bix_stand.png`, publish→`youtube upload --file … --slot … --privacy unlisted`,
  orchestrate→`orchestrate --slot … --privacy unlisted`. `spawn` is injectable for tests.
- **Runs are persisted** by `RunsStore` (`src/runs-store.ts`) in a new `runs` table
  **owned by the server** (id, kind, slot_id, args_json, status, exit_code, log,
  started_at, ended_at) — the only table this component writes.
- **Spend guardrails** (server-side, in `src/app.ts`): `POST /api/runs` refuses any
  spending kind (generate/publish/orchestrate) unless the body includes `confirm: true`
  (400) AND the required OAuth token is present (409 "needs login" — higgsfield for
  generate, youtube for publish, both for orchestrate). `script` (OpenAI-only) needs no
  confirm. publish/orchestrate default privacy **unlisted**. The browser never holds
  secrets; the server reads `.env`/tokens.
- **Auth seam** (`src/auth.ts`): if `DASHBOARD_TOKEN` is set, `/api/*` requires
  `Authorization: Bearer <token>` (401 otherwise); when unset it is a no-op, so local
  dev is open. `startServer` (`src/server.ts`) opens `data/bix.db`, wires the reader/
  media/jobs/runs, and in production also serves the built SPA from `apps/web/dist`
  (single-origin, no proxy). `PORT`/`BIX_DB`/`BIX_ROOT` come from env.
- API routes — reads (GET): `/api/health`, `/api/overview`, `/api/plans`,
  `/api/plans/:month/slots`, `/api/slots/:id`, `/api/events`, `/api/events/scans`,
  `/api/scripts/:slotId`, `/api/videos`, `/api/uploads`, `/api/report?key=`,
  `/api/media/video?key=`. Triggers: `POST /api/runs`, `GET /api/runs`,
  `GET /api/runs/:id`, `GET /api/runs/:id/stream` (SSE log + status).
- `apps/web` (`@bix/web`, Vite + React + react-router-dom + react-markdown, plain
  CSS dark theme). Pages: **Overview** (latest plan at a glance with decision/status
  filters and YouTube links), **Slot detail** (slot fields, reviewer verdict, rendered
  script/prompt markdown, `<video>` player, action buttons with confirm dialogs and a
  live SSE log panel), **Events**, **Plans** (rendered plan markdown), **Health**
  (env keys + OAuth login status), **Runs** (recent runs with expandable logs). Dev
  proxies `/api` → `http://localhost:8787`; its tsconfig is standalone (Bundler
  resolution) and not referenced by the root build.
- Tests: `read.test.ts` (in-memory SQLite seeded across all six tables → `overview()`
  join + every list/get; missing tables → empty), `media.test.ts` (range parsing +
  path-guards), `runs-store.test.ts`, `jobs.test.ts` (fake `spawn`: line capture,
  status transitions, spawn-error → FAILED), `app.test.ts` (`app.request()` smoke:
  overview/health/404/report-guard, `POST /api/runs` confirm + missing-token refusals,
  bearer-auth seam). Full suite green.
- **Deploy follow-up (designed, not built): OAuth browser logins can't run headless.**
  A cloud deployment needs a token-provisioning step — mount the owner's
  `data/youtube-tokens.json` / `data/higgsfield-tokens.json` (or the equivalent secret)
  into the server, or run the `login` commands on a machine with a browser and ship the
  resulting token files. Set `DASHBOARD_TOKEN` to lock the API. The storage seam is
  already in place (media/report reads go through `@bix/storage`), so a Cloud Storage
  `FileStorage` can replace `LocalFileStorage` without touching route code.

## How to run

- `npm install` - install dependencies.
- `npm run build` - type-check and compile all packages.
- `npm test` - run the test suite (vitest).
- `npm run config:check` - report each `.env` key as present/missing.
- `npm run video -- --prompt-file prompts/test-01.md --ref assets/character-reference.png`
  - Requires `FAL_KEY` in `.env` and a real reference image at the `--ref` path.
  - Output MP4 is written under `outputs/video/`.
  - Rerunning the same command resumes an in-flight job rather than resubmitting.
- `npm run video -- --provider avatar --prompt-file prompts/talking-test-01.md --ref assets/bix_stand.png --voice Will --resolution 480p --script "..."`
  - Talking mascot: the model generates the voice from `--script` and lip-syncs
    it (no separate audio). `--voice` is required; `--frames` optional (default
    145). The script must be long enough that the speech is >= the video length.
  - This model is slow (tens of minutes). If interrupted, rerun the same command
    to resume and download once fal finishes.
- `npm run higgsfield -- login`
  - One-time (per ~24h refresh window) OAuth for the Higgsfield MCP path. Opens a
    browser; tokens are saved to `data/higgsfield-tokens.json` (git-ignored).
  - `npm run higgsfield -- tools` lists the server's tools;
    `npm run higgsfield -- call <tool> <json|@file>` makes an ad-hoc MCP call.
- `npm run video -- --provider wan --prompt-file prompts/responde-a-bix-part1.md --ref assets/bix_stand.png --duration 30 --resolution 720p --aspect-ratio 9:16`
  - **Default provider.** Talking Bix via Higgsfield Wan 3.0 over MCP; spends
    Higgsfield **plan credits** (not `FAL_KEY`). Requires `higgsfield -- login`.
  - Duration 2-30s, resolution 480p/720p/1080p; native audio on by default.
  - Resumable like the fal path: rerun the same command to resume/download an
    in-flight job (a large download that gets `terminated` mid-transfer just
    needs one more rerun to finish).
- `npm run scan:events`
  - Requires `OPENAI_API_KEY` in `.env`. Makes paid OpenAI calls (web search +
    scoring). Holiday API is free/keyless.
  - Reads `config/events-scan.json` and `config/curated-calendar.json`.
  - Writes the report to `outputs/scans/events-YYYY-MM-DD.md` and saves ideas to
    SQLite.
- `npm run scan:competitors`
  - Requires `OPENAI_API_KEY` and `YOUTUBE_API_KEY` in `.env`. Makes paid OpenAI
    calls (analysis + planning) and free public YouTube Data API reads.
  - Reads `config/competitor-scan.json` and the latest `event_ideas` from SQLite.
  - Writes `outputs/plans/plan-YYYY-MM.md` and `.json`, and saves the plan to
    SQLite.
  - Prints the run's actual OpenAI cost (tokens -> dollars) at the end, and notes
    the separate web-search per-call fee. YouTube reads are free within quota.
- `npm run youtube -- login`
  - One-time (per refresh window) Google OAuth for uploading. Requires the owner
    to have created a Desktop-app OAuth client, enabled YouTube Data API v3, and
    set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` in `.env`. Opens a browser;
    tokens saved to `data/youtube-tokens.json` (git-ignored, 0600).
  - `npm run youtube -- status` shows token expiry, refresh presence and scope.
- `npm run youtube -- upload --file outputs/video/<clip>.mp4 --slot <id> --privacy unlisted`
  - Reads the plan slot's metadata, uploads the MP4, prints `https://youtu.be/<id>`.
    Re-running detects the COMPLETED record and skips (no duplicate). Use
    `unlisted` for the first live test; `public` is the default.
- `npm run video -- --provider wan --prompt-file ... --ref ... --publish --slot <id> --privacy unlisted`
  - Generates, then uploads in one pass. Requires `youtube -- login` first.
- `npm run script -- --slot 2026-09-003`
  - Writes a script for the plan slot and gates it with the AI reviewer. Requires
    `OPENAI_API_KEY` in `.env`. **Spends OpenAI tokens only — no video credits.**
  - Reads `config/script-writer.json` and the slot from SQLite (`plan_slots`).
  - Prints the reviewer decision + revision count, writes
    `outputs/scripts/script-<slotId>.md`, and on PASS writes
    `outputs/scripts/prompt-<slotId>.md` and prints the exact `npm run video`
    command to run next (which is the step that spends credits). Returns 0 on
    PASS, non-zero otherwise. `--date` picks the slot by date (errors if
    ambiguous); `--provider` / `--max-revisions` override the config defaults.
- `npm run orchestrate -- --slot 2026-09-003`
  - Runs the whole pipeline for one slot: script+review → (on PASS) generate →
    publish to YouTube as **unlisted**. Requires `OPENAI_API_KEY`, the video
    provider's login (Higgsfield for the default Wan) and `npm run youtube -- login`.
  - If the reviewer does not PASS it stops after the script phase (no video, no
    credits) and exits non-zero. `--provider`, `--ref`, `--privacy` and
    `--max-revisions` override the defaults; `--date` picks the slot by date.
- `npm run server` (API on port 8787) + `npm run web` (Vite dev server) - the
  pipeline dashboard (Component 7). Open the SPA; it proxies `/api` to the server.
  - **Overview** lists the latest plan; each slot shows its script decision, video
    status and YouTube link. **Slot detail** plays the generated MP4 and renders the
    script + reviewer verdict, with action buttons (script/generate/publish/orchestrate).
  - Reads are open in local dev. Triggering a spending action needs `confirm` in the
    request AND the relevant OAuth login (Higgsfield/YouTube); the server refuses
    otherwise. **Health** shows which logins/keys are present.
  - `npm run web:build` builds the SPA to `apps/web/dist`; in production
    (`NODE_ENV=production`) `npm run server` serves it from the same origin. Set
    `DASHBOARD_TOKEN` to require `Authorization: Bearer <token>` on `/api/*`.

## What is mocked / not built yet

- Component 3 has had one real run (2026-09-29), but only **Busuu** resolved -
  the other three channel handles are placeholders and were skipped. YouTube Data
  API v3 field shapes are now **verified against a live key** for the resolve +
  Shorts path (Busuu returned real titles/durations/counts).
- Competitor channel handles in `config/competitor-scan.json` are placeholders
  for Duolingo Spanish (`@duolingospanish`), Praktika (`@praktika_ai`) and Falou
  (`@falou_app`); confirm the real handles/IDs to widen the competitor sample.
- The holiday API v3 endpoint (`date.nager.at/api/v3`) is confirmed reachable and
  keyless; if it ever moves, change `holidayApiBaseUrl` in
  `config/events-scan.json`.
- Assumption to verify on first real video run: `duration` is sent as a JSON
  number (e.g. `5`); fal's schema lists `4`-`30` or `"auto"`. If fal rejects it,
  we switch to a string. No fake success - a rejection will surface as an error.
- The `Database` interface is currently synchronous (SQLite). A future
  PostgreSQL implementation may need an async variant.
- No scheduling, no GCP - local only for now.

## Keys

Keys live only in `.env` (git-ignored) and are filled in by the owner.
Reported by `npm run config:check` as present/missing:

- `FAL_KEY` - Component 1. (present)
- `OPENAI_API_KEY` - Components 2-4 (scans, planning, script writer + reviewer;
  also powers web search). (present)
- `YOUTUBE_API_KEY` - Component 3. (present)
- `YOUTUBE_CLIENT_ID` - Component 5 (Desktop-app OAuth client id). (missing until set)
- `YOUTUBE_CLIENT_SECRET` - Component 5 (paired client secret). (missing until set)

The Higgsfield MCP path uses **OAuth**, not an env key: tokens live only in
`data/higgsfield-tokens.json` (git-ignored, chmod 0600), created by
`npm run higgsfield -- login` and refreshed silently.

Component 5 (YouTube upload) also uses **OAuth**, but Google needs the owner's
Desktop-app client creds in `.env` (`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`)
because Google does not support dynamic client registration. Access/refresh
tokens live only in `data/youtube-tokens.json` (git-ignored, chmod 0600), created
by `npm run youtube -- login`.

## What's next

To improve Component 3's competitor sample (optional, when convenient):
1. Confirm the real handles/IDs for Duolingo Spanish, Praktika and Falou in
   `config/competitor-scan.json` (only Busuu resolved on the first run).
2. Re-run `npm run scan:competitors` to fold those channels into the insights.

Component 4 (script writer + AI reviewer) is **built and unit-tested**. To run it
for real (spends OpenAI tokens only, no video credits):
1. `npm run script -- --slot 2026-09-003` — writes the script, gates it with the
   reviewer, and on PASS emits the drop-in prompt file for `npm run video`.
2. Inspect `outputs/scripts/script-2026-09-003.md`; on PASS, generate with the
   printed `npm run video` command (that is the step that spends credits).

Component 6 (orchestrator) is **built**. To run it end-to-end for real:
1. Ensure `npm run youtube -- login` has been done (needs the Google Desktop
   OAuth creds in `.env`), and the Higgsfield login for the default Wan provider.
2. `npm run orchestrate -- --slot 2026-09-003` — script+review, then on PASS
   generate and publish the clip as unlisted; review it and flip to public.

Remaining loose ends (optional):
- Component 5's first live upload still needs `YOUTUBE_CLIENT_ID` /
  `YOUTUBE_CLIENT_SECRET` in `.env` (currently missing) + `npm run youtube -- login`.
- Confirm the three placeholder competitor handles (Component 3) to widen the
  competitor sample.
- A batch/scheduled orchestrator (run every due slot for a day/week) is a natural
  follow-up to today's one-slot command.

Component 7 (pipeline dashboard) is **built and unit-tested**, local-first. To run
it: `npm run server` + `npm run web`, then open the SPA. To deploy it later:
1. Provision OAuth tokens (browser login can't run headless) — mount the owner's
   `data/*-tokens.json` (or a secret) into the server, or log in on a browser machine
   and ship the token files.
2. Set `DASHBOARD_TOKEN` to lock `/api/*`, run `npm run web:build`, and serve with
   `NODE_ENV=production npm run server` (single origin). Swap `LocalFileStorage` for a
   Cloud Storage `FileStorage` via the existing `@bix/storage` seam if media moves off
   the local disk.
