We're building the Bix Social Console from scratch, one component at a time. The full product spec is in docs/Bix-Social-Console-Build-Prompt.md. Use it for context (brand, Bix's personality, formats, content rules, workspaces, safety rules), but only build the component I ask for in each step.

How we work
Build one component. Run its tests. Commit.
Stop, explain in plain language what you built, how to run it, and what I should check.
Wait for my go-ahead before starting the next component.
Keep docs/STATUS.md up to date: what works, what's mocked, what's next.
Never invent API endpoints, fields or prices. Check official docs; if something isn't confirmed, stop and ask.
Never show fake success. Unconfigured or unchecked things must say so plainly.
Keys only in .env (in .gitignore), filled in by me. Report keys only as present/missing; never print, log or commit values, and never ask me to paste keys into this chat.
Don't build cost estimates, budget caps or spending guardrails for now. We'll add cost tracking later.
Changes from the spec
Video generation uses fal.ai, not Higgsfield. Model: bytedance/seedance-2.5/reference-to-video via the official @fal-ai/client package. Use the standard endpoint, not the /us/ variant. Confirm the input fields, queue API (submit / status / result) and file upload for reference images from fal's docs. Keep it behind a provider adapter so we can swap providers later.
Run everything locally for now (SQLite behind interfaces that can later switch to PostgreSQL; local folders behind a storage interface that can later switch to Cloud Storage). GCP comes at the end.
No manual editing features anywhere. The owner only sets style/sources, uploads assets, and approves/skips/redoes.
The components, in order
Component 0: Skeleton
TypeScript monorepo (apps/, packages/, docs/), git initialised.
Config loader reading .env; .env.example with key names only.
SQLite set up behind a small storage interface, plus a local file-storage interface for assets and outputs.
Done when: the project builds, tests run, and a config check reports each key as present/missing without ever printing values.
Component 1: Video generation (fal Seedance 2.5)
Provider adapter: upload reference image(s), submit the job, save the request ID immediately, poll status, download the MP4.
A command like npm run video -- --prompt-file prompts/test-01.md --ref assets/character-reference.png.
First test: a short clip (about 5 seconds, 720p, 9:16, generate_audio: true) of Bix from a small prompt and one reference image, just to prove the pipeline and check that Bix looks right.
Resumable: if the process stops mid-render, rerunning picks up the saved request instead of submitting a new one.
Video model never renders text, captions or signs.
Done when: I'm holding a real MP4 of Bix, and a restart test proves an interrupted job is resumed rather than resubmitted.
Component 2: Weekly current-events scan
Runs on demand for now (npm run scan:events); scheduling comes later.
Sources: a public-holiday API (e.g. Nager.Date if it's free and keyless; confirm) for Mexico, Colombia, Spain, Argentina, US and UK; a news API (recommend one with a free tier and tell me why); and a small curated calendar file I can edit (e.g. Halloween 31 Oct, Día de Muertos 1–2 Nov, Thanksgiving 26 Nov 2026, Christmas, the Women's World Cup 2027 draw in December 2026).
OpenAI scores each topic for brand fit (0–10) for the Español workspace (Spanish speakers learning English), with a one-line reason, a suggested format, and a posting window (earliest and latest date).
Blocklist runs before and after scoring: tragedies, disasters, deaths, elections, politics, war, crime, health scares, plus keywords from a config file. Blocked topics are listed with the reason and never used.
Output: saved ideas (SQLite) plus a readable report outputs/scans/events-YYYY-MM-DD.md showing kept and blocked topics.
Done when: I can run it and read a sensible list of upcoming, on-brand topics with nothing sensitive slipping through.
Component 3: Monthly competitor scan → 30-day content plan
Runs on demand for now (npm run scan:competitors).
Pulls recent Shorts from tracked YouTube channels via the YouTube Data API (API key for public data; no OAuth needed yet): title, publish date, duration, views, likes and comments where available. Channel list in a config file; suggested defaults are Duolingo's Spanish-language channel, Praktika, Busuu and Falou (weighted lower, since its activity looks low). Resolve the actual channel IDs and ask me to confirm them before the first real run. Respect the API quota.
OpenAI summarises patterns: formats, hooks, lengths, posting rhythm, recurring themes, CTAs. Learn formats and trends only; never copy scripts or content. State clearly that public counts can't show organic vs paid reach or audience nationality.
Then it builds a 30-day content plan combining:
the competitor insights,
the latest events scan (Component 2),
evergreen ideas for our formats (Responde a Bix series, rehearse-then-panic, false-friend reveal, speaking dare),
the posting cadence and format mix from a config file (default: 5 Shorts per week for Español, Responde a Bix as the largest share).
Each plan slot: date, posting time (Mexico City time zone by default), format, topic/idea, source (event / competitor insight / evergreen), brand-fit score, hook idea in Bix's voice, why it's in the plan, and assets it will need.
Event slots respect their posting windows. The weekly events scan can later update event slots in the current plan without rebuilding the whole plan.
Output: plan saved (SQLite) plus outputs/plans/plan-YYYY-MM.md (readable) and a JSON version.
Done when: I can read a realistic, on-brand 30-day plan and see which competitor insights and events shaped it.

Stop after Component 3 and wait. Next steps, which I'll ask for one at a time:

Later components (don't build yet)
Script writer and AI reviewer: turns a plan slot into a script and Seedance prompt, reviewed PASS / REVISE / NEEDS_EVIDENCE before any video money is spent.
Full Short generation: plan slot → script → review → video (Component 1) for a complete 30-second Short.
Assembly with FFmpeg: subtitles, TTS answer lines, pauses, logo, end card.
Database and status machine: resumable pipeline for many Shorts.
Approval screen (the first dashboard page): approve, skip, redo with reasons.
YouTube publishing: OAuth, scheduled private uploads.
Asset library with descriptions, tags and automatic selection.
Analytics and the learning loop.
Move to GCP with Cloud Scheduler for the weekly and monthly runs.
Keys I'll add to .env over time
Component 1: FAL_KEY
Components 2–3: OPENAI_API_KEY, NEWS_API_KEY (whichever service you recommend), YOUTUBE_API_KEY

Tell me exactly which key each component needs before starting it.

Start with Component 0.