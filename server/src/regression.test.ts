import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, detect, median, type RunRow } from "./regression.js";

let id = 0;
const run = (
  build: string,
  startupMs: number | null,
  extra: Partial<RunRow["metrics"]> = {},
  status: RunRow["status"] = "pass",
): RunRow => ({
  id: ++id, scenario: "baseline", build, status,
  metrics: { startupMs, stallCount: 0, stallTotalMs: 0, ...extra },
});

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("no baseline means no findings", () => {
  assert.deepEqual(detect(run("b2", 5000), []), []);
});

test("flags startup that is worse both relatively and absolutely", () => {
  const base = [run("b1", 800), run("b1", 900), run("b1", 850)];
  const f = detect(run("b2", 2000), base);
  assert.equal(f.length, 1);
  assert.equal(f[0].metric, "startupMs");
});

test("ignores small changes", () => {
  assert.deepEqual(detect(run("b2", 1000), [run("b1", 800), run("b1", 900)]), []); // +18%
  assert.deepEqual(detect(run("b2", 1150), [run("b1", 800)]), []); // +350ms but under 1.5x
});

test("ignores tiny absolute jumps on small baselines", () => {
  assert.deepEqual(detect(run("b2", 250), [run("b1", 100)]), []); // 2.5x but only +150ms
});

test("flags pass -> fail", () => {
  const f = detect(run("b2", 800, {}, "fail"), [run("b1", 800)]);
  assert.equal(f[0].metric, "status");
});

test("stall regressions", () => {
  const f = detect(run("b2", 800, { stallCount: 4, stallTotalMs: 3000 }), [run("b1", 800)]);
  assert.deepEqual(f.map((x) => x.metric).sort(), ["stallCount", "stallTotalMs"]);
});

test("analyze baselines only against other builds", () => {
  // newest first: the second b3 run must not count as baseline for the first
  const [a] = analyze([run("b3", 3000), run("b3", 3100), run("b2", 800), run("b1", 850)]);
  assert.equal(a.baselineRuns, 2);
  assert.equal(a.findings[0].metric, "startupMs");
});
