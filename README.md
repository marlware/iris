# Iris — Instrumented Reliability in Streaming

Automated HLS playback reliability testing: real playback in Chrome, instrumented with hls.js,
driven by Playwright, results persisted to PostgreSQL and shown in a React dashboard.
Iris consumes HLS; it doesn't encode. ffmpeg is only used to generate the test fixture.

## Run it
```
npm install
npm run fixture      # generate fixtures/basic (HLS test stream)
npm run db:up        # PostgreSQL on :5433
npm run test:e2e     # starts API + web, plays the stream, asserts, stores result
npm run dev:server   # then npm run dev:web -> http://localhost:5173 for the results UI
```
Requires Docker and Google Chrome (bundled Chromium lacks H.264).

## CI
`.github/workflows/ci.yml`: typecheck + unit tests, then the Playwright suite against a Postgres service container.
Build id is the commit SHA; the HTML report is uploaded as an artifact. Each CI run starts with an empty database,
so regression comparison only works locally for now (see below).

## Regression detection
Each scenario's latest run is compared with the median of up to 5 passing runs from other builds (`GET /api/regressions`).

## Layout
- `server/` Express + pg REST API (`GET/POST /api/runs`), serves `/streams`
- `web/` React + Vite: results dashboard (`/`) and instrumented player harness (`/player`)
- `e2e/` Playwright tests; read `window.__iris` metrics and POST results
