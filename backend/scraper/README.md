# Placement Portal Scraper

Fault-tolerant background scraper for the SSR PHP placement portal, built with
**Puppeteer** + **node-cron** using modern ES6 modules. Browser navigation is
fully decoupled from the cron scheduling wrapper.

## Layout
```
backend/scraper/
├── index.js            # node-cron scheduling wrapper + lifecycle/signals
├── .env                # secrets & selectors (never commit real values)
└── src/
    ├── config.js       # loads + validates env (fails fast if missing)
    ├── browser.js      # launch / login / harvest / deep-crawl (navigation logic)
    ├── scraper.js      # one cycle: try/catch/finally matrix + failure tracking
    ├── db.js           # MongoDB Atlas upsert (keyed by detailUrl)
    ├── notifier.js     # Discord webhook hook (fires after N consecutive fails)
    ├── errors.js       # DomMutationError / AuthError / ScrapeError
    └── logger.js       # structured JSON logger
```

## Schedule
- **Day (08:00–19:30):** every 30 min  → `*/30 8-19 * * *`
- **Night (20:00–06:00):** every 2 hrs → `0 20,22,0,2,4,6 * * *`

Uses the host timezone. Set `TZ=Asia/Kolkata` (or your zone) in the environment
to anchor the windows correctly.

## Configuration (.env)
| Key | Purpose |
|-----|---------|
| `LOGIN_URL` | Portal login page |
| `PORTAL_EMAIL` / `PORTAL_PASSWORD` | Credentials (read from env only) |
| `DISCORD_WEBHOOK_URL` | Failure-alert webhook |
| `MONGO_URI` / `DB_NAME` / `COLLECTION_NAME` | Atlas storage |
| `EMAIL_SELECTOR` / `PASSWORD_SELECTOR` / `SUBMIT_SELECTOR` | Login inputs |
| `MAX_CONSECUTIVE_FAILURES` | Alert threshold (default 3) |
| `MAX_ROWS` | Cap rows deep-crawled per run (0 = all) |
| `HEADLESS` | `true` (default) / `false` |
| `NAV_TIMEOUT_MS` | Navigation timeout (default 60000) |
| `RUN_ON_BOOT` | Run one cycle immediately on start |

## Run
```bash
cd backend/scraper
yarn install
node index.js            # start scheduler (long-running)
node index.js --once     # single cycle then exit (manual/test)
MAX_ROWS=3 node index.js --once   # throttled test run
```

## Resiliency model
- Every cycle is wrapped in a global try/catch/**finally**; the browser is
  always closed (no leaked Chromium processes).
- Missing `table` / `th` / `td` / anchor → structured `DomMutationError`.
- After `MAX_CONSECUTIVE_FAILURES` back-to-back failures, a Discord alert is
  dispatched flagging a probable upstream DOM mutation. The counter resets on
  the first success.
- Overlapping cron ticks are skipped while a run is in flight.

## Portal-specific note
The detail link's `href` is `#`; the real URL lives in the anchor's
`onclick="window.open('details.php?detail=...')"`. The harvester extracts and
resolves it to an absolute URL automatically.
