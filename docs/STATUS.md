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

**Component 2: Weekly current-events scan** - code done; awaiting a real run by
the owner (makes paid OpenAI calls). Needs `OPENAI_API_KEY` (present).

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

## What is mocked / not built yet

- Component 2 has not had a real run yet in this repo - it is covered by unit
  tests with mock providers (search, holidays, scorer). The owner still needs to
  run it once (paid) to hold a real report.
- The holiday API v3 endpoint (`date.nager.at/api/v3`) is confirmed reachable and
  keyless; if it ever moves, change `holidayApiBaseUrl` in
  `config/events-scan.json`.
- Assumption to verify on first real run: `duration` is sent as a JSON number
  (e.g. `5`); fal's schema lists `4`-`30` or `"auto"`. If fal rejects it, we
  switch to a string. No fake success - a rejection will surface as an error.
- YouTube integration (Component 3) not built.
- The `Database` interface is currently synchronous (SQLite). A future
  PostgreSQL implementation may need an async variant.
- No scheduling, no GCP - local only for now.

## Keys

Keys live only in `.env` (git-ignored) and are filled in by the owner.
Reported by `npm run config:check` as present/missing:

- `FAL_KEY` - Component 1. (present)
- `OPENAI_API_KEY` - Components 2-3 (also powers web search in Component 2).
- `YOUTUBE_API_KEY` - Component 3.

## What's next

Owner to run `npm run scan:events` once (paid) and sanity-check the report:
sensible upcoming on-brand topics, nothing sensitive slipping through.

Then Component 3: Monthly competitor scan -> 30-day content plan (YouTube Data
API + OpenAI). Needs `YOUTUBE_API_KEY` (missing). Waiting for go-ahead.
