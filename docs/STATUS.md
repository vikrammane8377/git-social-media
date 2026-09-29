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

**Component 1: Video generation (fal Seedance 2.5)** - code done; awaiting a
real end-to-end run by the owner (needs a reference image).

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

## How to run

- `npm install` - install dependencies.
- `npm run build` - type-check and compile all packages.
- `npm test` - run the test suite (vitest).
- `npm run config:check` - report each `.env` key as present/missing.
- `npm run video -- --prompt-file prompts/test-01.md --ref assets/character-reference.png`
  - Requires `FAL_KEY` in `.env` and a real reference image at the `--ref` path.
  - Output MP4 is written under `outputs/video/`.
  - Rerunning the same command resumes an in-flight job rather than resubmitting.

## What is mocked / not built yet

- No real fal call has been run yet in this repo - the pipeline is covered by
  unit tests with a mock provider. The owner still needs to run it once with a
  real reference image to hold an actual MP4.
- Assumption to verify on first real run: `duration` is sent as a JSON number
  (e.g. `5`); fal's schema lists `4`-`30` or `"auto"`. If fal rejects it, we
  switch to a string. No fake success - a rejection will surface as an error.
- OpenAI / YouTube integrations (Components 2-3) not built.
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

Component 2: Weekly current-events scan (OpenAI web search + holiday API +
curated calendar). Needs `OPENAI_API_KEY`. Waiting for go-ahead.
