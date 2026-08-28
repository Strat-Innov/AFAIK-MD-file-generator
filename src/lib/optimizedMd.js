/* ------------------------------------------------------------------ *
 * AI-OPTIMIZED representation — the retrieval layer.
 *
 * Renders a PageModel to Markdown for Copilot Studio. Every string it
 * emits comes verbatim from the source; this module chooses structure
 * and ordering, never wording. No summarizing, no paraphrasing, no
 * inferred facts, no invented URLs.
 *
 * Section structure is derived from the page, not from a template:
 * each SharePoint canvas control is a section, and heading depth
 * within a control is preserved relative to that control's own top
 * heading. A page without an "Amenities" heading gets no Amenities
 * section.
 * ------------------------------------------------------------------ */

import { GENERATOR_VERSION } from "./version.js";

const esc = (s) => s.replace(/([*_`[\]])/g, "\\$1");

function headingPrefix(level, minLevel, isTitle) {
  if (isTitle) return "#";
  return "#".repeat(Math.min(6, 2 + Math.max(0, level - minLevel)));
}

function renderTextSection(section, { titleTaken }) {
  const headings = section.blocks.filter((b) => b.type === "heading");
  const minLevel = headings.length ? Math.min(...headings.map((b) => b.level)) : 2;
  const out = [];
  let usedTitle = titleTaken;

  for (const block of section.blocks) {
    if (block.type === "heading") {
      const isTitle = !usedTitle && block.level === minLevel;
      out.push(`${headingPrefix(block.level, minLevel, isTitle)} ${block.text}`);
      usedTitle = true;
    } else if (block.type === "paragraph") {
      // Each source line stays its own line: SharePoint's <br>-separated
      // facts (a unit type, its size, its price) must not fuse.
      out.push(block.lines.join("\n"));
    } else if (block.type === "list") {
      out.push(block.items.map((it, i) => (block.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join("\n"));
    } else if (block.type === "table") {
      const [head, ...body] = block.rows;
      const width = Math.max(...block.rows.map((r) => r.length));
      const row = (cells) => `| ${Array.from({ length: width }, (_, i) => (cells[i] || "").replace(/\|/g, "\\|")).join(" | ")} |`;
      out.push([row(head), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(row)].join("\n"));
    }
  }
  return { md: out.join("\n\n"), usedTitle };
}

function renderWebPart(content) {
  const c = content;
  if (c.type === "links") {
    const items = c.items.map((i) => (i.url ? `- [${esc(i.title || i.url)}](${i.url})` : `- ${esc(i.title)}`));
    return [c.title ? `## ${c.title}` : "", items.join("\n")].filter(Boolean).join("\n\n");
  }
  if (c.type === "people") {
    const items = c.persons.map((p) => {
      const parts = [p.name, p.role, p.email].filter(Boolean);
      return `- ${parts.join(" — ")}`;
    });
    return [c.title ? `## ${c.title}` : "", items.join("\n")].filter(Boolean).join("\n\n");
  }
  if (c.type === "image") {
    const facts = [c.caption, c.overlay, c.alt].filter(Boolean);
    const body = facts.join("\n") + (c.linkUrl ? `\n${c.linkUrl}` : "");
    return body.trim();
  }
  if (c.type === "agent") return `## ${c.title}`;
  if (c.type === "other") {
    const body = [...c.texts.map((t) => `- ${t}`), ...c.urls.map((u) => `- ${u}`)].join("\n");
    return [c.title ? `## ${c.title}` : "", body].filter(Boolean).join("\n\n");
  }
  return "";
}

function sourceSection(page) {
  const rows = [];
  if (page.name) rows.push(`- Source file: ${page.name}`);
  if (page.path && page.path !== page.name) rows.push(`- Source path: ${page.path}`);
  if (page.metadata.siteBaseUrl) rows.push(`- SharePoint site: ${page.metadata.siteBaseUrl}`);
  if (page.metadata.pageLayoutType) rows.push(`- Page layout: ${page.metadata.pageLayoutType}`);
  if (page.metadata.authorByline) rows.push(`- Author: ${page.metadata.authorByline}`);
  if (page.metadata.topicHeader) rows.push(`- Topic: ${page.metadata.topicHeader}`);
  // Provenance, not page content: the "## Source" block is excluded from
  // coverage validation, so stamping the generator here records which
  // build produced the document without asserting anything about the
  // source.
  rows.push(`- Generator: ${GENERATOR_VERSION}`);
  return rows.length ? ["## Source", rows.join("\n")].join("\n\n") : "";
}

export function renderOptimized(page) {
  const parts = [];
  let titleTaken = false;

  for (const section of page.sections) {
    if (section.kind === "text") {
      const { md, usedTitle } = renderTextSection(section, { titleTaken });
      titleTaken = usedTitle;
      if (md.trim()) parts.push(md);
    } else {
      const md = renderWebPart(section.content);
      if (md.trim()) parts.push(md);
    }
  }

  // No heading anywhere in the page: fall back to the file's own name so
  // the document still has an identifying title. The name is a fact
  // about the source, not an invented one.
  if (!titleTaken && page.name) parts.unshift(`# ${page.name.replace(/\.aspx$/i, "")}`);

  const source = sourceSection(page);
  if (source) parts.push(source);

  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
