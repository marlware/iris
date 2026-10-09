import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PlaybackMetrics } from "../../web/src/instrument";

const API = "http://localhost:3001";

interface Check { name: string; pass: boolean; detail: string }

async function report(request: APIRequestContext, scenario: string, metrics: PlaybackMetrics, checks: Check[]) {
  const res = await request.post(`${API}/api/runs`, {
    data: {
      scenario,
      build: process.env.IRIS_BUILD ?? "local",
      status: checks.every((c) => c.pass) ? "pass" : "fail",
      metrics,
      checks,
    },
  });
  expect(res.ok()).toBeTruthy();
  for (const c of checks) expect.soft(c.pass, `${c.name}: ${c.detail}`).toBeTruthy();
}

const snapshot = (page: Page) => page.evaluate(() => window.__iris!.snapshot()) as Promise<PlaybackMetrics>;

/** Load the player through the fault proxy with the given spec. */
async function open(page: Page, spec: string, stream = "basic/index.m3u8") {
  const token = randomUUID();
  // IRIS_EXTRA_SPEC fakes a slower build, e.g. IRIS_EXTRA_SPEC=delay=1500
  const full = [spec, process.env.IRIS_EXTRA_SPEC].filter(Boolean).join(",");
  await page.goto(`/player?src=/chaos/${encodeURIComponent(full)}/${token}/${stream}`);
}

/** Wait for N seconds of playback or a fatal error, whichever comes first. */
async function settle(page: Page, seconds: number, timeout = 40_000) {
  await page.waitForFunction(
    (s) => {
      const m = window.__iris?.snapshot();
      return !!m && (m.playedSeconds >= s || m.fatalErrors > 0);
    },
    seconds,
    { timeout },
  );
  return snapshot(page);
}

const noFatal = (m: PlaybackMetrics): Check => ({
  name: "no fatal errors", pass: m.fatalErrors === 0, detail: m.errors.join(", ") || "none",
});
const startupUnder = (m: PlaybackMetrics, ms: number): Check => ({
  name: `startup < ${ms}ms`, pass: m.startupMs !== null && m.startupMs < ms, detail: `${m.startupMs}ms`,
});
const played = (m: PlaybackMetrics, s: number): Check => ({
  name: `played >= ${s}s`, pass: m.playedSeconds >= s, detail: `${m.playedSeconds}s`,
});

test("baseline: clean playback", async ({ page, request }) => {
  await open(page, "none");
  const m = await settle(page, 8);
  await report(request, "baseline", m, [
    startupUnder(m, 3000),
    { name: "no stalls", pass: m.stallCount === 0, detail: `${m.stallCount} stalls / ${m.stallTotalMs}ms` },
    noFatal(m),
    played(m, 8),
  ]);
});

test("latency: +400ms on every request", async ({ page, request }) => {
  await open(page, "delay=400");
  const m = await settle(page, 8);
  await report(request, "latency-400ms", m, [startupUnder(m, 5000), noFatal(m), played(m, 8)]);
});

test("low bandwidth: 400kbps cap on a ~750kbps stream", async ({ page, request }) => {
  await open(page, "bw=400");
  const m = await settle(page, 8, 55_000);
  await report(request, "bandwidth-400kbps", m, [
    // sanity check that the throttle actually bites
    { name: "stalls observed", pass: m.stallCount > 0, detail: `${m.stallCount} stalls / ${m.stallTotalMs}ms` },
    noFatal(m),
    played(m, 8),
  ]);
});

test("transient segment failure: seg 3 returns 503 twice, then recovers", async ({ page, request }) => {
  await open(page, "fail=seg_003.ts:503:2");
  const m = await settle(page, 12);
  await report(request, "segment-503-transient", m, [
    { name: "error was injected", pass: m.errors.length > 0, detail: m.errors.join(", ") || "none" },
    noFatal(m),
    { name: "recovery < 5000ms", pass: m.recoveryMs !== null && m.recoveryMs < 5000, detail: `${m.recoveryMs}ms` },
    played(m, 12),
  ]);
});

test("missing segment: seg 3 always 404s", async ({ page, request }) => {
  await open(page, "fail=seg_003.ts:404");
  const m = await settle(page, 12);
  // The player should give up and say so. Quietly carrying on would be the bug.
  await report(request, "segment-404-permanent", m, [
    { name: "failure surfaced as fatal", pass: m.fatalErrors > 0, detail: m.errors.join(", ") || "none" },
    { name: "stopped before the gap", pass: m.playedSeconds < 8, detail: `${m.playedSeconds}s` },
  ]);
});

test("unavailable manifest: index.m3u8 returns 503", async ({ page, request }) => {
  await open(page, "fail=index.m3u8:503");
  const m = await settle(page, 5, 20_000);
  await report(request, "manifest-503", m, [
    { name: "failure surfaced as fatal", pass: m.fatalErrors > 0, detail: m.errors.join(", ") || "none" },
    { name: "no first frame", pass: m.startupMs === null, detail: `${m.startupMs}` },
  ]);
});

/** Seek, then wait for the player to put a frame on screen at the new position. */
async function seekTo(page: Page, t: number) {
  const before = (await snapshot(page)).seeks.length;
  await page.evaluate((t) => window.__iris!.seek(t), t);
  await page.waitForFunction(
    (n) => {
      const s = window.__iris!.snapshot();
      return s.seeks.length > n && s.seeks[s.seeks.length - 1].resumeMs !== null;
    },
    before,
    { timeout: 20_000 },
  );
}

for (const [label, spec, limit] of [
  ["seek", "none", 3000],
  ["seek-latency-400ms", "delay=400", 5000],
] as const) {
  test(`${label}: forward, back, forward again`, async ({ page, request }) => {
    await open(page, spec);
    await page.waitForFunction(() => (window.__iris?.snapshot().playedSeconds ?? 0) >= 3, null, { timeout: 30_000 });

    // 22s is well past anything buffered; 2s goes back to already-played media.
    await seekTo(page, 22);
    await seekTo(page, 2);
    await seekTo(page, 14);
    // and confirm it keeps playing afterwards
    await page.waitForFunction(() => (window.__iris?.snapshot().playedSeconds ?? 0) >= 17, null, { timeout: 20_000 });
    const m = await snapshot(page);

    await report(request, label, m, [
      { name: "3 seeks completed", pass: m.seeks.filter((s) => s.resumeMs !== null).length === 3, detail: JSON.stringify(m.seeks.map((s) => s.resumeMs)) },
      { name: `every seek resumed < ${limit}ms`, pass: m.seekMaxMs !== null && m.seekMaxMs < limit, detail: `max ${m.seekMaxMs}ms` },
      {
        name: "landed within 2s of target",
        pass: m.seeks.every((s) => s.landedAt !== null && Math.abs(s.landedAt - s.target) <= 2),
        detail: m.seeks.map((s) => `${s.target}->${s.landedAt}`).join(", "),
      },
      noFatal(m),
      played(m, 17),
    ]);
  });
}

const ABR = "abr/master.m3u8";
const topLevel = (m: PlaybackMetrics) => Math.max(...m.renditions.map((r) => r.level));
const peakLevel = (m: PlaybackMetrics) => Math.max(-1, ...m.levelSwitches.map((s) => s.level));

test("abr: unthrottled, climbs to the top rendition", async ({ page, request }) => {
  await open(page, "none", ABR);
  const m = await settle(page, 12);
  await report(request, "abr-clean", m, [
    { name: "3 renditions in ladder", pass: m.renditions.length === 3, detail: m.renditions.map((r) => `${r.height}p@${Math.round(r.bitrate / 1000)}k`).join(" ") },
    { name: "reached top rendition", pass: peakLevel(m) === topLevel(m), detail: `peak ${peakLevel(m)} of ${topLevel(m)}` },
    startupUnder(m, 3000),
    { name: "no stalls", pass: m.stallCount === 0, detail: `${m.stallCount} stalls / ${m.stallTotalMs}ms` },
    noFatal(m),
  ]);
});

test("abr: 600kbps cap, stays on low renditions without stalling", async ({ page, request }) => {
  await open(page, "bw=600", ABR);
  const m = await settle(page, 12, 55_000);
  await report(request, "abr-throttled-600kbps", m, [
    { name: "never picked top rendition", pass: peakLevel(m) < topLevel(m), detail: `levels ${m.levelSwitches.map((s) => s.level).join(">")}` },
    { name: "at most 1 stall", pass: m.stallCount <= 1, detail: `${m.stallCount} stalls / ${m.stallTotalMs}ms` },
    startupUnder(m, 6000),
    noFatal(m),
    played(m, 12),
  ]);
});

test("abr: bandwidth drops to 500kbps at 4s, player steps down", async ({ page, request }) => {
  const dropAt = 4000;
  await open(page, `drop=${dropAt}:500`, ABR);
  const m = await settle(page, 24, 80_000);
  const down = m.levelSwitches.find((s) => s.tMs > dropAt && s.level < peakLevel(m));
  await report(request, "abr-bandwidth-drop", m, [
    { name: "climbed before the drop", pass: m.levelSwitches.some((s) => s.tMs < dropAt && s.level >= 1), detail: JSON.stringify(m.levelSwitches) },
    { name: "stepped down after the drop", pass: !!down, detail: down ? `${down.tMs - dropAt}ms after drop -> level ${down.level}` : "never" },
    { name: "stalled under 3s total", pass: m.stallTotalMs < 3000, detail: `${m.stallCount} stalls / ${m.stallTotalMs}ms` },
    noFatal(m),
    played(m, 24),
  ]);
});
