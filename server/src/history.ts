// Moves run history in and out of Postgres so CI, which starts with an empty database, can
// compare against earlier builds.
//
//   npm run history -w server -- import <file.json>
//   npm run history -w server -- export <file.json>
//   npm run history -w server -- report          (markdown summary of regressions, to stdout)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { migrate, pool } from "./db.js";
import { analyze } from "./regression.js";

const KEEP = 1000; // newest runs kept in the exported file

const [cmd, file] = process.argv.slice(2);
await migrate();

try {
  if (cmd === "import") {
    const rows: Record<string, unknown>[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    for (const r of rows) {
      await pool.query(
        "INSERT INTO runs (scenario, build, status, metrics, checks, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [r.scenario, r.build, r.status, JSON.stringify(r.metrics), JSON.stringify(r.checks), r.created_at],
      );
    }
    console.log(`imported ${rows.length} runs`);
  } else if (cmd === "export") {
    const { rows } = await pool.query(
      `SELECT scenario, build, status, metrics, checks, created_at FROM (
         SELECT * FROM runs ORDER BY id DESC LIMIT $1
       ) newest ORDER BY id ASC`,
      [KEEP],
    );
    writeFileSync(file, JSON.stringify(rows, null, 1));
    console.log(`exported ${rows.length} runs`);
  } else if (cmd === "report") {
    const { rows } = await pool.query("SELECT id, scenario, build, status, metrics FROM runs ORDER BY id DESC LIMIT 500");
    const results = analyze(rows);
    const regressed = results.filter((r) => r.findings.length > 0);
    console.log("## Iris regression report\n");
    console.log(`Build \`${results[0]?.build.slice(0, 7) ?? "?"}\`, ${results.length} scenarios.\n`);
    if (results.every((r) => r.baselineRuns === 0)) {
      console.log("No earlier builds to compare against yet.");
    } else if (regressed.length === 0) {
      console.log("No regressions against earlier builds.");
    } else {
      console.log("| Scenario | Finding |\n|---|---|");
      for (const r of regressed) for (const f of r.findings) console.log(`| ${r.scenario} | ${f.message} |`);
    }
  } else {
    console.error("usage: history <import|export|report> [file]");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
