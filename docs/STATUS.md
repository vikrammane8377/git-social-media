# Bix Social Console - Status

Last updated: 2026-09-29

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

**Component 3: Monthly competitor scan -> 30-day content plan** - code done;
awaiting a real run (needs `YOUTUBE_API_KEY`, currently MISSING, plus confirmed
channel IDs). Uses `OPENAI_API_KEY` (present).

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
- Channel handles in config are **unconfirmed placeholders**; the real channel
  IDs for Duolingo Spanish, Praktika, Busuu and Falou (weighted lower) must be
  confirmed before the first real run (the CLI prints this reminder too).

## How to run

- `npm install` - install dependencies.
- `npm run build` - type-check and compile all packages.
- `npm test` - run the test suite (vitest).
- `npm run config:check` - report each `.env` key as present/missing.
- `npm run video -- --prompt-file prompts/test-01.md --ref assets/character-reference.png`
  - Requires `FAL_KEY` in `.env` and a real reference image at the `--ref` path.
  - Output MP4 is written under `outputs/video/`.
  - Rerunning the same command resumes an in-flight job rather than resubmitting.
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

## What is mocked / not built yet

- Component 3 has not had a real run yet - it is covered by unit tests with mock
  providers (YouTube client, LLM client, analyst, planner, events reader). It
  needs `YOUTUBE_API_KEY` and confirmed channel IDs before a real run.
- YouTube Data API v3 field shapes follow the documented contract but are
  **unverified against a live key** (no key yet). The base URL is in
  `config/competitor-scan.json` if it ever changes.
- Competitor channel handles in `config/competitor-scan.json` are placeholders;
  confirm the real channel IDs before the first real run.
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
- `YOUTUBE_API_KEY` - Component 3. (MISSING)

## What's next

For Component 3's first real run, the owner needs to:
1. Add `YOUTUBE_API_KEY` to `.env` (YouTube Data API v3 key, public data only).
2. Confirm the real channel IDs/handles for Duolingo Spanish, Praktika, Busuu and
   Falou in `config/competitor-scan.json` (current handles are placeholders).
3. Run `npm run scan:competitors` (paid OpenAI + free YouTube) and sanity-check
   `outputs/plans/plan-YYYY-MM.md`: on-brand 30-day plan, sensible event slots
   inside their windows, competitor insights that clearly shaped it.

Then Component 4 (script writer + AI reviewer) - not started; waiting for
go-ahead.
