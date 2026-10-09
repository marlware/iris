import { useEffect, useState } from "react";

interface Check { name: string; pass: boolean; detail: string }
interface Run {
  id: number; scenario: string; build: string; status: "pass" | "fail";
  metrics: { startupMs: number | null; recoveryMs?: number | null; seekMaxMs?: number | null; levelSwitches?: unknown[]; errors?: string[]; stallCount: number; stallTotalMs: number; segmentsLoaded: number; playedSeconds: number };
  checks: Check[]; created_at: string;
}

interface Analysis {
  scenario: string; build: string; baselineRuns: number;
  findings: { metric: string; message: string }[];
}

export function Results() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [analysis, setAnalysis] = useState<Analysis[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/runs").then((r) => r.json()).then(setRuns).catch(() => {});
    const loadAnalysis = () => fetch("/api/regressions").then((r) => r.json()).then(setAnalysis).catch(() => {});
    load();
    loadAnalysis();
    const t = setInterval(() => { load(); loadAnalysis(); }, 3000);
    return () => clearInterval(t);
  }, []);

  const regressed = analysis.filter((a) => a.findings.length > 0);

  return (
    <main style={{ fontFamily: "system-ui", margin: "2rem auto", maxWidth: 960 }}>
      <h1>Iris â€” playback test runs</h1>
      {regressed.length > 0 ? (
        <section style={{ background: "#fdecea", border: "1px solid crimson", borderRadius: 6, padding: "0.5rem 1rem", marginBottom: "1rem" }}>
          <strong>Regressions vs. earlier builds</strong>
          <ul>
            {regressed.map((a) => (
              <li key={a.scenario}><b>{a.scenario}</b> (build {a.build}): {a.findings.map((f) => f.message).join("; ")}</li>
            ))}
          </ul>
        </section>
      ) : analysis.some((a) => a.baselineRuns > 0) ? (
        <p style={{ color: "green" }}>No regressions in the latest run of any scenario.</p>
      ) : null}
      <table cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th>#</th><th>Scenario</th><th>Build</th><th>Status</th><th>Startup (ms)</th>
            <th>Stalls</th><th>Recovery (ms)</th><th>Seek max (ms)</th><th>Switches</th><th>Errors</th><th>Stall ms</th><th>Segments</th><th>Played (s)</th><th>When</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }} title={r.checks.map((c) => `${c.pass ? "âœ“" : "âœ—"} ${c.name}: ${c.detail}`).join("\n")}>
              <td>{r.id}</td><td>{r.scenario}</td><td>{r.build}</td>
              <td style={{ color: r.status === "pass" ? "green" : "crimson", fontWeight: 600 }}>{r.status.toUpperCase()}</td>
              <td>{r.metrics.startupMs ?? "â€“"}</td><td>{r.metrics.stallCount}</td><td>{r.metrics.recoveryMs ?? "–"}</td><td>{r.metrics.seekMaxMs ?? "–"}</td><td>{r.metrics.levelSwitches?.length ?? "–"}</td><td>{r.metrics.errors?.length ?? 0}</td>
              <td>{r.metrics.stallTotalMs}</td><td>{r.metrics.segmentsLoaded}</td>
              <td>{r.metrics.playedSeconds}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 && <p>No runs yet. Run <code>npm run test:e2e</code>.</p>}
    </main>
  );
}
