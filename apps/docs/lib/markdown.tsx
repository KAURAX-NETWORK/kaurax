/**
 * A small Markdown renderer.
 *
 * Deliberately not a full parser and deliberately not `dangerouslySetInnerHTML`: the docs
 * use a narrow subset — headings, lists, tables, fenced code, links, emphasis — and
 * rendering it as React elements means no HTML from a file can ever execute.
 */
import type {ReactNode} from "react";

export function Markdown({source}: {source: string}) {
  return <div className="markdown">{render(source)}</div>;
}

function render(source: string): ReactNode[] {
  const lines = source.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code.
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i]!), i++;
      i++;
      out.push(
        <pre key={key++} className="md-code" data-lang={lang}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Tables.
    if (line.includes("|") && lines[i + 1]?.match(/^\s*\|?[\s:|-]+\|[\s:|-]*$/)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      out.push(
        <div className="table-wrap" key={key++} style={{margin: "16px 0"}}>
          <table>
            <thead><tr>{header.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Headings.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      const Tag = (`h${Math.min(level, 6)}`) as "h1";
      out.push(<Tag key={key++} className={`md-h${level}`}>{inline(text)}</Tag>);
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) body.push(lines[i]!.replace(/^>\s?/, "")), i++;
      out.push(<blockquote key={key++} className="md-quote">{body.map((b, j) => <p key={j}>{inline(b)}</p>)}</blockquote>);
      continue;
    }

    // Lists.
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(<Tag key={key++} className="md-list">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</Tag>);
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // Paragraph.
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !lines[i]!.startsWith("#") && !lines[i]!.startsWith("```")) {
      para.push(lines[i]!);
      i++;
    }
    out.push(<p key={key++} className="md-p">{inline(para.join(" "))}</p>);
  }

  return out;
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

/** Inline emphasis, code and links, rendered as elements rather than injected HTML. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];

    if (token.startsWith("`")) {
      parts.push(<code key={key++} className="md-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const href = link[2]!;
        const internal = !href.startsWith("http");
        parts.push(
          <a
            key={key++}
            href={internal ? toDocHref(href) : href}
            target={internal ? undefined : "_blank"}
            rel={internal ? undefined : "noreferrer"}
          >
            {link[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Turn a relative repository link into a docs-site route. */
function toDocHref(href: string): string {
  const clean = href.replace(/^\.\//, "").replace(/^\.\.\//, "").replace(/#.*$/, "");
  if (!clean.endsWith(".md")) return href;
  const slug = clean.replace(/\.md$/, "").toLowerCase();
  return slug.startsWith("docs/") ? `/${slug}` : `/docs/${slug.split("/").pop()}`;
}
