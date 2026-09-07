#!/usr/bin/env tsx
/**
 * Apply SQL migrations in order, once each.
 *
 * Migrations are plain `.sql` files named `NNN_description.sql`. Each runs inside its own
 * transaction, and `schema_migrations` records what has been applied, so re-running is
 * safe and partial application is impossible.
 */
import {readdirSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createPool, waitForDatabase} from "./db.js";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function migrate(databaseUrl: string): Promise<number> {
  const pool = createPool(databaseUrl);
  await waitForDatabase(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const applied = new Set<number>(
    (await pool.query<{version: string}>("SELECT version FROM schema_migrations")).rows.map((r) =>
      Number(r.version),
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (!Number.isInteger(version)) {
      throw new Error(`migration "${file}" does not start with a numeric version`);
    }
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      // The migration files carry their own BEGIN/COMMIT so that a file can control its
      // own transaction boundaries where it needs to.
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [
        version,
      ]);
      console.log(`[migrate] applied ${file}`);
      ran++;
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  await pool.end();
  return ran;
}

/**
 * Run directly: `tsx src/migrate.ts` or `node dist/migrate.js`.
 * Compared through fileURLToPath rather than string-building a file:// URL, which differs
 * between runtimes and breaks silently (the script exits 0 having done nothing).
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)).replace(/\.(ts|js)$/, "") ===
    resolve(process.argv[1]).replace(/\.(ts|js)$/, "");

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url)
    .then((n) => console.log(n === 0 ? "[migrate] already up to date" : `[migrate] ${n} migration(s) applied`))
    .catch((err: Error) => {
      console.error(`[migrate] ${err.message}`);
      process.exit(1);
    });
}
