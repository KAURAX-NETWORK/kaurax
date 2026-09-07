/**
 * Documentation loader.
 *
 * The content is the repository's own markdown, collected into docs-content.ts by
 * scripts/collect-docs.mjs before each build. That indirection exists for a reason: this
 * used to read the files at request time by walking up from process.cwd() to find the
 * repository root, which works locally and fails in a serverless bundle — the tracer
 * follows static imports and never saw a path assembled at runtime, so the deployed
 * function contained no documents and the site listed nothing.
 *
 * Generating at build time keeps the property that mattered, one source of truth, and
 * removes every runtime assumption about where files are.
 */
import {DOCS, type DocContent} from "./docs-content";

export interface DocEntry {
  slug: string;
  title: string;
  group: "start" | "protocol";
}

export function listDocs(): DocEntry[] {
  return DOCS.map(({slug, title, group}) => ({slug, title, group}));
}

export function readDoc(slug: string): {title: string; markdown: string} | null {
  const found: DocContent | undefined = DOCS.find((d) => d.slug === slug);
  return found ? {title: found.title, markdown: found.markdown} : null;
}
