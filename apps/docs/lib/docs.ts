/**
 * Documentation loader.
 *
 * Renders the repository's own `docs/` directory rather than a separate copy, so the site
 * cannot drift from the documentation the engineers actually maintain.
 */
import {readFileSync, readdirSync, existsSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export interface DocEntry {
  slug: string;
  title: string;
  file: string;
}

const ROOT_DOCS = ["README.md", "MAINNET_READINESS.md", "KAURAX_INFRA_AUDIT.md", "ARCHITECTURE.md", "DEPLOYMENT.md", "SECURITY.md", "CONTRIBUTING.md"];

/** Every document, in a deliberate reading order rather than alphabetical. */
export function listDocs(): DocEntry[] {
  const root = repoRoot();
  const docsDir = join(root, "docs");
  const entries: DocEntry[] = [];

  for (const name of ROOT_DOCS) {
    const p = join(root, name);
    if (existsSync(p)) {
      entries.push({slug: name.replace(/\.md$/, "").toLowerCase(), title: titleOf(p, name), file: p});
    }
  }

  if (existsSync(docsDir)) {
    const preferred = [
      "README.md", "architecture.md", "STACK_DECISION.md", "l3.md", "ethereum.md",
      "underlying-l2.md", "sequencer.md", "batcher.md", "settlement.md",
      "data-availability.md", "bridge.md", "developers.md", "sdk.md", "contracts.md",
      "wallet.md", "ai.md", "validators.md", "security.md", "threat-model.md",
      "decentralization.md", "mainnet-readiness.md",
    ];
    const present = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    const ordered = [...preferred.filter((f) => present.includes(f)), ...present.filter((f) => !preferred.includes(f))];

    for (const name of ordered) {
      const p = join(docsDir, name);
      const slug = `docs/${name.replace(/\.md$/, "").toLowerCase()}`;
      entries.push({slug, title: titleOf(p, name), file: p});
    }
  }

  return entries;
}

function titleOf(path: string, fallback: string): string {
  try {
    const first = readFileSync(path, "utf8").split("\n").find((l) => l.startsWith("# "));
    return first ? first.replace(/^#\s*/, "").trim() : fallback.replace(/\.md$/, "");
  } catch {
    return fallback.replace(/\.md$/, "");
  }
}

export function readDoc(slug: string): {title: string; markdown: string} | null {
  const entry = listDocs().find((d) => d.slug === slug);
  if (!entry) return null;
  // Confine reads to the repository, so a crafted slug cannot escape it.
  const resolved = resolve(entry.file);
  if (!resolved.startsWith(resolve(repoRoot()))) return null;
  try {
    return {title: entry.title, markdown: readFileSync(resolved, "utf8")};
  } catch {
    return null;
  }
}
