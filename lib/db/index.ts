import { Pool } from "pg";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

export * from "./types";
export { queries } from "./queries";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://localhost:5432/agent_os";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return _pool;
}

let _initialized = false;

export async function initDb(): Promise<Pool> {
  const pool = getPool();

  if (!_initialized) {
    await createSchema(pool);
    await runMigrations(pool);
    _initialized = true;
  }

  return pool;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _initialized = false;
  }
}
