export interface RunMetrics {
  startupMs: number | null;
  stallCount: number;
  stallTotalMs: number;
  recoveryMs?: number | null;
  seekMaxMs?: number | null;
}

export interface RunRow {
  id: number;
  scenario: string;
  build: string;
  status: "pass" | "fail";
  metrics: RunMetrics;
}

export interface Finding {
  metric: string;
  current: number | string;
  baseline: number | string;
  message: string;
}

// metric -> [relative factor, minimum absolute increase]. Both have to be exceeded,
// so tiny baselines don't trip on noise and big ones can't hide a real slowdown.
const RULES: Record<string, [number, number]> = {
  startupMs: [1.5, 300],
  stallCount: [1.5, 2],
  stallTotalMs: [1.5, 500],
  recoveryMs: [1.5, 500],
  seekMaxMs: [1.5, 500],
};

export const BASELINE_RUNS = 5;

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Compare one run against runs from earlier builds of the same scenario. */
export function detect(current: RunRow, baseline: RunRow[]): Finding[] {
  if (baseline.length === 0) return [];
  const findings: Finding[] = [];

  if (current.status === "fail" && baseline.every((b) => b.status === "pass")) {
    findings.push({ metric: "status", current: "fail", baseline: "pass", message: "passed on earlier builds, fails now" });
  }

  for (const [metric, [factor, minDelta]] of Object.entries(RULES)) {
    const cur = current.metrics[metric as keyof RunMetrics];
    if (typeof cur !== "number") continue;
    const base = median(
      baseline.map((b) => b.metrics[metric as keyof RunMetrics]).filter((v): v is number => typeof v === "number"),
    );
    if (base === null) continue;
    if (cur > base * factor && cur - base > minDelta) {
      findings.push({
        metric, current: cur, baseline: base,
        message: base > 0 ? `${metric} ${base} -> ${cur} (${Math.round(((cur - base) / base) * 100)}% worse)` : `${metric} ${base} -> ${cur}`,
      });
    }
  }
  return findings;
}

/** rows must be newest first. One result per scenario, based on that scenario's latest run. */
export function analyze(rows: RunRow[]) {
  const byScenario = new Map<string, RunRow[]>();
  for (const r of rows) byScenario.set(r.scenario, [...(byScenario.get(r.scenario) ?? []), r]);

  return [...byScenario.entries()].map(([scenario, runs]) => {
    const [current, ...older] = runs;
    const baseline = older.filter((r) => r.build !== current.build && r.status === "pass").slice(0, BASELINE_RUNS);
    return {
      scenario,
      build: current.build,
      runId: current.id,
      baselineRuns: baseline.length,
      findings: detect(current, baseline),
    };
  });
}
