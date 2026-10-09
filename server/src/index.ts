import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, pool } from "./db.js";
import { chaos } from "./chaos.js";
import { analyze } from "./regression.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Clean fixtures, plus a fault-injecting variant under /chaos.
const fixtures = path.resolve(here, "../../fixtures");
app.use("/streams", express.static(fixtures));
app.use("/chaos/:spec/:token", chaos(fixtures));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/runs", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM runs ORDER BY id DESC LIMIT 100");
    res.json(rows);
  } catch (e) { next(e); }
});

// Latest run of each scenario vs. the median of recent runs from earlier builds.
app.get("/api/regressions", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id, scenario, build, status, metrics FROM runs ORDER BY id DESC LIMIT 500");
    res.json(analyze(rows));
  } catch (e) { next(e); }
});

app.post("/api/runs", async (req, res, next) => {
  try {
  const { scenario, build = "local", status, metrics, checks } = req.body ?? {};
  if (!scenario || !["pass", "fail"].includes(status) || !metrics || !checks) {
    return res.status(400).json({ error: "scenario, status(pass|fail), metrics, checks required" });
  }
  const { rows } = await pool.query(
    "INSERT INTO runs (scenario, build, status, metrics, checks) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [scenario, build, status, JSON.stringify(metrics), JSON.stringify(checks)],
  );
  res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

await migrate();
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`iris server on :${port}`));
