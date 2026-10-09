# Deploy: Bix Social Console on a GCP VM

Run the pipeline 24/7 on a single Compute Engine VM:

- **4 scheduled jobs** via systemd timers — monthly competitor scan, weekly
  events scan, and two daily Shorts (one per channel: Spanish + Global).
- **Dashboard** (`@bix/server` + built SPA) as a long-running systemd service,
  reached over an SSH tunnel.

Heavy work (video / scripts / captions) runs on external APIs, so the box stays
lightweight. These are deployment artifacts only — no application code changes.

---

## What ships, and what must come out-of-band

The repo's `.gitignore` excludes `.env`, `data/`, `outputs/`, `assets/`, and
`dist/`. The code comes from git; everything below is copied to the VM
separately (step 4):

| File                                 | Why                                              |
| ------------------------------------ | ------------------------------------------------ |
| `.env`                               | API keys (see root `.env.example` for the shape) |
| `data/youtube-tokens.spanish.json`   | YouTube OAuth refresh token (Spanish channel)    |
| `data/youtube-tokens.global.json`    | YouTube OAuth refresh token (Global channel)     |
| `data/higgsfield-tokens.json`        | Higgsfield session (refreshes while jobs run)    |
| `assets/bix_stand.png`               | Default reference image for video generation     |
| `data/bix.db` *(optional)*           | Preserves the current plan + upload idempotency  |

A legacy single `data/youtube-tokens.json` (no channel suffix) is still read as
the **Spanish** channel's token for back-compat; ship per-channel files for a
clean multi-channel setup, or re-run `youtube login --channel <id>` on the VM.

If you don't ship `data/bix.db`, you bootstrap a fresh plan on the VM (step 7).

---

## VM sizing

- **Compute Engine e2-small** (2 vCPU burst, 2 GB RAM) — headroom for `tsc` +
  Vite build.
  - The free-tier **e2-micro** works for *runtime*, but may OOM during the Vite
    build. If you must use it, add 2 GB swap **or** build `dist/` on the Mac and
    ship it.
- **Ubuntu 22.04 LTS** (systemd 249 — supports timezone-qualified `OnCalendar`).
- Keep the **VM clock in UTC**. The timers carry timezone suffixes; systemd
  handles DST.
- **Node 22.x** (required for stable built-in `node:sqlite`, no flag; WAL mode).
- Deploy path `/opt/bix-learn-sm`, service user `bix`.

---

## Prerequisites (owner, one-time)

1. **Get the code reachable.** Recommended: commit the outstanding work and push
   to a **private GitHub repo**, then `git clone` on the VM (clean updates via
   `git pull`). Alternative: `rsync` the working tree (excluding `node_modules`).
2. **Plan cadence.** Confirm the monthly plan yields one Spanish + one Global
   slot per day so the two daily timers each find a slot. (Plan-shaping is a
   separate task; deployment runs whatever the plan contains.)
3. **GCP project + billing**, and `gcloud` installed locally.

---

## Runbook

Replace `<zone>` (e.g. `us-central1-a`) and `<private-repo>` throughout.

### 1. Create the VM

```bash
gcloud compute instances create bix \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --zone=<zone>
```

### 2. Install Node 22 + git; create the service user

SSH in: `gcloud compute ssh bix --zone=<zone>`, then:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version   # expect v22.x

sudo useradd --system --create-home --shell /usr/sbin/nologin bix
sudo mkdir -p /opt/bix-learn-sm
sudo chown -R bix:bix /opt/bix-learn-sm
```

### 3. Get the code

```bash
sudo -u bix git clone <private-repo> /opt/bix-learn-sm
```

*(Private repo auth: a deploy key or a fine-grained PAT. Or `rsync` the working
tree, excluding `node_modules`.)*

### 4. Ship secrets + assets from the Mac

From the repo root on the Mac (push into a staging dir, then move into place as
`bix`, since the target is owned by `bix`):

```bash
gcloud compute scp \
  .env \
  data/youtube-tokens.spanish.json \
  data/youtube-tokens.global.json \
  data/higgsfield-tokens.json \
  assets/bix_stand.png \
  bix:/tmp/ --zone=<zone>

# optional: preserve the existing plan + upload history
gcloud compute scp data/bix.db bix:/tmp/ --zone=<zone>
```

On the VM, place them and lock down the secrets:

```bash
sudo -u bix mkdir -p /opt/bix-learn-sm/data /opt/bix-learn-sm/assets
sudo mv /tmp/.env /opt/bix-learn-sm/.env
sudo mv /tmp/youtube-tokens.spanish.json /tmp/youtube-tokens.global.json \
  /tmp/higgsfield-tokens.json /opt/bix-learn-sm/data/
sudo mv /tmp/bix_stand.png /opt/bix-learn-sm/assets/
sudo mv /tmp/bix.db /opt/bix-learn-sm/data/ 2>/dev/null || true
sudo chown -R bix:bix /opt/bix-learn-sm
sudo chmod 600 /opt/bix-learn-sm/.env \
  /opt/bix-learn-sm/data/youtube-tokens.spanish.json \
  /opt/bix-learn-sm/data/youtube-tokens.global.json \
  /opt/bix-learn-sm/data/higgsfield-tokens.json
```

### 5. Build

```bash
cd /opt/bix-learn-sm
sudo -u bix npm ci
sudo -u bix npm run build       # tsc project refs -> */dist (incl. apps/cli/dist, packages/server/dist)
sudo -u bix npm run web:build   # vite -> apps/web/dist
```

### 6. Add the dashboard token

Append a random token to `.env` so `/api/*` requires `Authorization: Bearer`:

```bash
echo "DASHBOARD_TOKEN=$(openssl rand -hex 32)" | sudo -u bix tee -a /opt/bix-learn-sm/.env
```

See `deploy/env.example` for the full set of deployment env notes.

### 7. Bootstrap a plan (skip if you shipped `data/bix.db`)

```bash
cd /opt/bix-learn-sm
sudo -u bix node apps/cli/dist/index.js scan:competitors   # seeds this month's plan
sudo -u bix node apps/cli/dist/index.js scan:events        # verify events scan works
```

### 8. Install the systemd units

```bash
sudo cp /opt/bix-learn-sm/deploy/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
```

### 9. Enable the service + timers

```bash
sudo systemctl enable --now bix-dashboard.service
sudo systemctl enable --now bix-daily-spanish.timer
sudo systemctl enable --now bix-daily-global.timer
sudo systemctl enable --now bix-events-scan.timer
sudo systemctl enable --now bix-competitors-scan.timer

systemctl list-timers 'bix-*'   # expect 4 timers with sane next-run times
```

### 10. Smoke test (spends nothing)

```bash
cd /opt/bix-learn-sm
sudo -u bix NODE_ENV=production node apps/cli/dist/index.js \
  run-daily --channel spanish --dry-run     # prints the chosen slot

journalctl -u bix-daily-spanish.service --no-pager   # once a run has fired
```

### 11. Reach the dashboard (SSH tunnel — default)

The dashboard binds to localhost only; no inbound firewall rule is needed.

```bash
gcloud compute ssh bix --zone=<zone> -- -L 8787:localhost:8787
```

Open `http://localhost:8787`. The SPA prompts for the token and sends it as
`Authorization: Bearer <DASHBOARD_TOKEN>`.

*Optional public URL:* add a firewall rule + a Caddy reverse proxy with TLS, and
keep `DASHBOARD_TOKEN` on. (Out of scope here; SSH tunnel is the default.)

### 12. Updating later

```bash
cd /opt/bix-learn-sm
sudo -u bix git pull
sudo -u bix npm ci
sudo -u bix npm run build
sudo -u bix npm run web:build
sudo systemctl restart bix-dashboard
```

---

## Operational notes

- **Token longevity.** Each channel's YouTube refresh token is long-lived (app is
  in Production). Higgsfield's session refreshes silently as long as a job runs
  within its ~24h window — the daily timers keep it alive. If the VM is down for
  a long stretch, re-run the browser logins and re-`scp` the token files (one per
  channel). To (re)authorize a channel directly on the VM, run
  `node apps/cli/dist/index.js youtube login --channel <spanish|global>` and pick
  that channel's Brand Account at the Google consent screen.
- **Backups.** Nightly copy of `data/bix.db` (holds the plan, scripts, and
  upload records). A simple approach — a `cron` entry or a 5th timer:
  `cp data/bix.db data/backups/bix-$(date +%F).db`.
- **Failure visibility.** Oneshot timers exit non-zero on failure, so
  `systemctl status bix-*.service` and `journalctl -u <unit>` surface it. An
  `OnFailure=` notifier unit is a later add-on, not in scope.
- **Disk.** A daily Short's local MP4s (raw + captioned, ~10–86 MB each) are
  **deleted automatically** by `orchestrate` as soon as the clip is successfully
  posted to YouTube — YouTube is the source of truth, so the box keeps only
  `data/bix.db`. No retention cron is needed for the daily pipeline. If a run
  fails *before* publishing, its MP4 stays on disk so a re-run can resume
  cheaply; those are the only files that can linger. To sweep any such leftovers:
  `find outputs/video -name '*.mp4' -mtime +7 -delete`.

---

## Reference: units installed

| Unit                           | Type     | Schedule / role                               |
| ------------------------------ | -------- | --------------------------------------------- |
| `bix-dashboard.service`        | simple   | Long-running API + SPA on `:8787` (localhost) |
| `bix-daily-spanish.timer`      | timer    | `13:00 America/Mexico_City` (= 19:00 UTC)     |
| `bix-daily-global.timer`       | timer    | `18:00 UTC`                                   |
| `bix-events-scan.timer`        | timer    | `Mon 06:00 America/Mexico_City`               |
| `bix-competitors-scan.timer`   | timer    | `1st of month 05:00 America/Mexico_City`      |
| `bix-daily-spanish.service`    | oneshot  | `run-daily --channel spanish --privacy public`|
| `bix-daily-global.service`     | oneshot  | `run-daily --channel global --privacy public` |
| `bix-events-scan.service`      | oneshot  | `scan:events`                                 |
| `bix-competitors-scan.service` | oneshot  | `scan:competitors`                            |

All units run as `User=bix`, `WorkingDirectory=/opt/bix-learn-sm`,
`EnvironmentFile=/opt/bix-learn-sm/.env`. Timers use `Persistent=true` to catch
a run missed during downtime.

**Timing rationale.** These are **placeholder defaults** — edit each timer's
`OnCalendar` to the owner's preferred slot time. Spanish 13:00 America/Mexico_City
= 19:00 UTC (Mexico has no DST); Global 18:00 UTC (fixed, year-round). Both daily
jobs fire well inside the same UTC day, so `run-daily`'s local-date slot selection
stays correct with the VM clock in UTC.

---

## End-to-end verification

1. `systemctl list-timers 'bix-*'` shows **4 timers** with sane next-run times.
2. `run-daily --channel spanish --dry-run` picks today's Spanish slot (no spend);
   `run-daily --channel global --dry-run` picks today's Global slot.
3. Dashboard loads over the tunnel; the Health page shows all keys present +
   both OAuth logins valid; Overview lists the current plan.
4. Let one real daily timer fire (or run
   `node apps/cli/dist/index.js run-daily --channel spanish --privacy public`
   manually) → a public Short appears on **Bix Learn Spanish (@bixlearn-es)**,
   the slot flips to published in the dashboard, and re-running the same day is
   a no-op (idempotent). The Global timer publishes to the Global channel the
   same way with `--channel global`.

---

## Out of scope / parked

- Plan-shaping to exactly one Spanish + one Global slot per day (separate task;
  affects plan contents, not deploy).
- Public TLS dashboard via Caddy (optional; SSH tunnel is the default).
- Cloud Storage `FileStorage` swap (seam exists; not needed on a single VM).
