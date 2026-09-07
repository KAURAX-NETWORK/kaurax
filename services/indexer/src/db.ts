/** PostgreSQL access for the indexer. Thin, explicit, no ORM. */
import pg from "pg";

const {Pool} = pg;

/**
 * `pg` returns NUMERIC as a string by default, which is exactly what is wanted: these are
 * uint256 values and parsing them into a JS number would lose precision above 2^53.
 * This makes that intent explicit rather than relying on the default staying put.
 */
pg.types.setTypeParser(1700, (v: string) => v); // numeric
pg.types.setTypeParser(20, (v: string) => v); // int8 / bigint

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Wait for PostgreSQL to accept connections. Containers start out of order. */
export async function waitForDatabase(pool: pg.Pool, attempts = 60, delayMs = 1000): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`database did not become ready: ${(last as Error)?.message}`);
}

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
