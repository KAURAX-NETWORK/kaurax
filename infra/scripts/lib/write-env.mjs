#!/usr/bin/env node
/**
 * Update KEY=VALUE pairs in .env in place, preserving comments and ordering.
 * Used by the devnet scripts to record deployed contract addresses so that the node,
 * explorer and CLI all read one source of truth.
 */
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

/** Walk upward to the repository root so this helper can be moved without breaking. */
function repoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the KAURAX repository root");
}

const root = repoRoot();
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  console.error("write-env: .env does not exist");
  process.exit(1);
}

const updates = new Map();
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf("=");
  if (eq < 0) continue;
  updates.set(arg.slice(0, eq), arg.slice(eq + 1));
}

const lines = readFileSync(envPath, "utf8").split("\n");
const applied = new Set();

for (let i = 0; i < lines.length; i++) {
  const match = /^([A-Z0-9_]+)=/.exec(lines[i]);
  if (!match) continue;
  const key = match[1];
  if (!updates.has(key)) continue;
  lines[i] = `${key}=${updates.get(key)}`;
  applied.add(key);
}

for (const [key, value] of updates) {
  if (!applied.has(key)) lines.push(`${key}=${value}`);
}

writeFileSync(envPath, lines.join("\n"));
console.log(`    wrote ${[...updates.keys()].join(", ")} to .env`);
