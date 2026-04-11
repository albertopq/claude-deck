import type { Pool } from "pg";

interface Migration {
  id: number;
  name: string;
  up: (pool: Pool) => Promise<void>;
}

const migrations: Migration[] = [];

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(`SELECT id FROM _migrations`);
  const applied = new Set(result.rows.map((r: { id: number }) => r.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    try {
      await migration.up(pool);
      await pool.query(`INSERT INTO _migrations (id, name) VALUES ($1, $2)`, [
        migration.id,
        migration.name,
      ]);
      console.log(`Migration ${migration.id}: ${migration.name} applied`);
    } catch (error) {
      console.error(
        `Migration ${migration.id}: ${migration.name} failed:`,
        error
      );
      throw error;
    }
  }
}
