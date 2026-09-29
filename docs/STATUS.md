# Bix Social Console - Status

Last updated: 2026-09-29

## What works

**Component 0: Skeleton** - done.

- TypeScript monorepo using npm workspaces:
  - `packages/config` (`@bix/config`) - config loader.
  - `packages/storage` (`@bix/storage`) - SQLite + local file storage.
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
- Tests pass (12 tests) and the project builds with `tsc`.

## How to run

- `npm install` - install dependencies.
- `npm run build` - type-check and compile all packages.
- `npm test` - run the test suite (vitest).
- `npm run config:check` - report each `.env` key as present/missing.

## What is mocked / not built yet

- No provider integrations yet (fal, OpenAI, news, YouTube) - those are
  Components 1-3.
- The `Database` interface is currently synchronous (SQLite). A future
  PostgreSQL implementation may need an async variant.
- No scheduling, no GCP - local only for now.

## Keys

Keys live only in `.env` (git-ignored) and are filled in by the owner.
Reported by `npm run config:check` as present/missing:

- `FAL_KEY` - Component 1.
- `OPENAI_API_KEY` - Components 2-3.
- `NEWS_API_KEY` - Component 2.
- `YOUTUBE_API_KEY` - Component 3.

## What's next

Component 1: Video generation (fal Seedance 2.5). Needs `FAL_KEY` in `.env`.
Waiting for go-ahead before starting.
