import Link from "next/link";
import {notFound} from "next/navigation";
import {listDocs, readDoc} from "@/lib/docs";
import {Markdown} from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function DocPage({params}: {params: Promise<{slug: string[]}>}) {
  const {slug} = await params;
  const doc = readDoc(slug.join("/").toLowerCase());
  if (!doc) notFound();

  const all = listDocs();
  const index = all.findIndex((d) => d.slug === slug.join("/").toLowerCase());
  const prev = index > 0 ? all[index - 1] : null;
  const next = index >= 0 && index < all.length - 1 ? all[index + 1] : null;

  return (
    <div className="container page">
      <div style={{marginBottom: 18}}>
        <a href="/" className="mono-sm">← All documentation</a>
      </div>

      <article className="card" style={{padding: "26px 30px"}}>
        <Markdown source={doc.markdown} />
      </article>

      <div className="row-gap" style={{marginTop: 22}}>
        {prev ? <Link href={`/${prev.slug}`}>← {prev.title}</Link> : null}
        <span className="right" />
        {next ? <Link href={`/${next.slug}`}>{next.title} →</Link> : null}
      </div>
    </div>
  );
}
