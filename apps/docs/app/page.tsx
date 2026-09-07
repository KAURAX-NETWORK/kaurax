import Link from "next/link";
import {listDocs} from "@/lib/docs";
import {Banner} from "@kaurax/ui";

export const dynamic = "force-dynamic";

export default function DocsIndex() {
  const docs = listDocs();
  const root = docs.filter((d) => !d.slug.startsWith("docs/"));
  const protocolDocs = docs.filter((d) => d.slug.startsWith("docs/"));

  return (
    <div className="container page">
      <h1>KAURAX Documentation</h1>
      <p className="lede">
        Rendered directly from the repository, so this site cannot drift from the
        documentation the engineers maintain.
      </p>

      <Banner kind="warn">
        <strong>Read the honest limits first.</strong> KAURAX has no fault proof system, a
        centralized sequencer, and no audits. Start with the threat model and mainnet
        readiness before building anything that matters on it.
      </Banner>

      <div className="grid cols-2" style={{marginTop: 22}}>
        <div className="card">
          <h2>Start here</h2>
          <ul className="md-list">
            {root.map((d) => (
              <li key={d.slug}>
                <Link href={`/${d.slug}`}>{d.title}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2>Protocol &amp; operations</h2>
          <ul className="md-list" style={{columns: 2, columnGap: 24}}>
            {protocolDocs.map((d) => (
              <li key={d.slug}>
                <Link href={`/${d.slug}`}>{d.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
