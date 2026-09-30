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
- `OPENAI_API_KEY` - Components 2-3 (also powers web search). (present)
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

Then Component 4 (script writer + AI reviewer) - not started; waiting for
go-ahead.
