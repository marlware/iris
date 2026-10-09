import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://iris:iris@localhost:5433/iris",
});

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS runs (
      id          SERIAL PRIMARY KEY,
      scenario    TEXT        NOT NULL,
      build       TEXT        NOT NULL DEFAULT 'local',
      status      TEXT        NOT NULL CHECK (status IN ('pass','fail')),
      metrics     JSONB       NOT NULL,
      checks      JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}
