/* ------------------------------------------------------------------ *
 * Deterministic ASPX -> PageModel extraction. No LLM, no heuristics
 * beyond what the SharePoint canvas format itself declares. The same
 * input always produces the same PageModel.
 *
 * A modern SharePoint page stores its content in mso:CanvasContent1 as
 * a flat sequence of [data-sp-canvascontrol] elements. Each carries a
 * data-sp-controldata JSON blob naming its controlType:
 *
 *   4 -> rich text (prose, headings, lists, tables) in [data-sp-rte]
 *   3 -> web part  (JSON in data-sp-webpartdata)
 *   0 -> page settings slice (no user-visible content)
 *
 * Verified against the three real exported pages in test/fixtures/.
 * Document order matches the controls' zone/section/control indices,
 * so canvas order is reading order and each control is a section.
 * ------------------------------------------------------------------ */

import { extractTag, decodeOnce } from "./masterMd.js";
import {
  decodeEntitiesOnce,
  isImageAssetUrl,
  PEOPLE_ID,
  QUICK_LINKS_ID,
  IMAGE_ID,
  AGENT_LINK_ID,
} from "./webparts.js";

const CONTROL_TEXT = 4;
const CONTROL_WEBPART = 3;

/* ---------------- inline text ---------------- */

// Renders an element's inline content to text, keeping anchors as
// Markdown links (the URL is meaningful) and turning <br> into a line
// break (SharePoint uses <br> to separate individual facts inside one
// paragraph — "97-120 sqm" and "P25.5M - P27.3M" are separate lines of
// one <p>, and collapsing them would fuse two distinct values).
function inlineText(node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += child.data; continue; }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toUpperCase();
    if (tag === "BR") { out += "\n"; continue; }
    if (tag === "IMG") { const alt = child.getAttribute("alt"); if (alt) out += alt; continue; }
    if (tag === "A") {
      const href = child.getAttribute("href");
      const label = inlineText(child).trim();
      out += href && label ? `[${label}](${href})` : label || href || "";
      continue;
    }
    out += inlineText(child);
  }
  return out;
}

// Collapses runs of whitespace but keeps explicit line breaks, and
// normalizes the non-breaking spaces SharePoint's editor sprinkles in.
function tidy(s) {
  return s.replace(/ /g, " ").replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function lines(s) {
  return tidy(s).split("\n").map((l) => l.trim()).filter(Boolean);
}

/* ---------------- rich-text blocks ---------------- */

// A list item can hold several block-level children. SharePoint's
// editor produces <li><p>The Palms Country Club</p><p>Private Access
// </p><p>(Exclusive for Club Members)</p></li>, and running inlineText
// over the whole <li> concatenates them with no separator, fusing three
// distinct facts into "The Palms Country ClubPrivate Access…". Each
// block child becomes its own item line, in source order.
function itemLines(li) {
  const blocks = [...li.children].filter((c) => /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(c.tagName.toUpperCase()));
  if (!blocks.length) return tidy(inlineText(li)).split("\n");
  const lines = [];
  // Text sitting directly in the <li>, before or between its blocks.
  for (const node of li.childNodes) {
    if (node.nodeType === 3) { const t = tidy(node.data); if (t) lines.push(...t.split("\n")); continue; }
    if (node.nodeType !== 1) continue;
    if (/^(UL|OL)$/.test(node.tagName.toUpperCase())) continue;
    lines.push(...tidy(inlineText(node)).split("\n"));
  }
  return lines;
}

function listItems(listEl) {
  const items = [];
  for (const li of listEl.children) {
    if (li.tagName?.toUpperCase() !== "LI") continue;
    // Take the item's own content without the nested list, then append
    // the nested items after it, so nothing is fused and nothing is lost.
    const nested = [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName.toUpperCase()));
    const clone = li.cloneNode(true);
    for (const c of [...clone.children]) if (/^(UL|OL)$/.test(c.tagName.toUpperCase())) c.remove();
    items.push(...itemLines(clone));
    for (const n of nested) items.push(...listItems(n));
  }
  return items.map((i) => i.trim()).filter(Boolean);
}

function tableRows(tableEl) {
  const rows = [];
  for (const tr of tableEl.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("th,td")].map((c) => tidy(inlineText(c)).replace(/\n/g, " "));
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function collectBlocks(root, blocks = []) {
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      for (const l of lines(child.data)) blocks.push({ type: "paragraph", lines: [l] });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toUpperCase();

    if (/^H[1-6]$/.test(tag)) {
      const text = tidy(inlineText(child)).replace(/\n/g, " ");
      if (text) blocks.push({ type: "heading", level: Number(tag[1]), text });
    } else if (tag === "P") {
      const ls = lines(inlineText(child));
      if (ls.length) blocks.push({ type: "paragraph", lines: ls });
    } else if (tag === "UL" || tag === "OL") {
      const items = listItems(child);
      if (items.length) blocks.push({ type: "list", ordered: tag === "OL", items });
    } else if (tag === "TABLE") {
      const rows = tableRows(child);
      if (rows.length) blocks.push({ type: "table", rows });
    } else if (tag === "HR" || tag === "BR" || tag === "IMG" || tag === "SCRIPT" || tag === "STYLE") {
      // Pure rendering, or handled by the web part that owns it.
    } else {
      collectBlocks(child, blocks);
    }
  }
  return blocks;
}

/* ---------------- web parts ---------------- */

// Note: blob.title is deliberately never used as a heading fallback.
// For a recognized part it holds SharePoint's web-part *type* name
// ("People", "Divider") rather than anything a reader saw, so emitting
// it would put a label in the optimized document that no source value
// backs. A part with no authored title simply gets no heading.

function json(el, attr) {
  const raw = el.getAttribute(attr);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// serverProcessedContent values are HTML-escaped inside the JSON
// ("Socials &amp; Websites"), so they need one entity pass to become
// the text a reader actually saw.
// Whitespace is collapsed because these are single-line values —
// titles, labels, names. A quick link titled "Procurement\n Request"
// would otherwise split a Markdown link across two lines.
const text = (v) => (typeof v === "string" ? decodeEntitiesOnce(v).replace(/\s+/g, " ").trim() : "");

function indexedValues(map, suffix) {
  const out = [];
  for (const [key, value] of Object.entries(map || {})) {
    const m = key.match(/^items\[(\d+)\]\.(.+)$/);
    if (m && m[2] === suffix) out[Number(m[1])] = text(value);
  }
  return out;
}

function quickLinks(blob) {
  const spt = blob?.serverProcessedContent?.searchablePlainTexts || {};
  const links = blob?.serverProcessedContent?.links || {};
  const titles = indexedValues(spt, "title");
  const urls = indexedValues(links, "sourceItem.url");
  const items = [];
  for (let i = 0; i < Math.max(titles.length, urls.length); i++) {
    const title = titles[i] || "";
    const url = urls[i] || "";
    if (title || url) items.push({ title, url });
  }
  return items.length ? { type: "links", title: text(spt.title), items } : null;
}

function people(blob) {
  const spt = blob?.serverProcessedContent?.searchablePlainTexts || {};
  const roles = (blob?.properties?.persons || []).map((p) => text(p?.role));
  const persons = [];
  for (const [key, value] of Object.entries(spt)) {
    const m = key.match(/^persons\[(\d+)\]\.name$/);
    if (!m) continue;
    const i = Number(m[1]);
    persons[i] = { name: text(value), email: text(spt[`persons[${i}].email`]), role: roles[i] || "" };
  }
  const list = persons.filter((p) => p && (p.name || p.email));
  // The section heading ("MARKETING", "LEASING", "PROJECT DEVELOPMENT")
  // is stored in searchablePlainTexts.title; properties.title is
  // usually absent. Reading only the latter dropped the department
  // labels that make a contact list answerable.
  const title = text(spt.title) || text(blob?.properties?.title);
  return list.length ? { type: "people", title, persons: list } : null;
}

function image(blob) {
  const p = blob?.properties || {};
  const caption = text(p.captionText);
  const alt = text(p.altText);
  const overlay = text(p.overlayText);
  // The click-through target is recorded under serverProcessedContent
  // .links.linkUrl; properties.linkUrl is frequently empty.
  const candidate = text(p.linkUrl) || text(blob?.serverProcessedContent?.links?.linkUrl);
  const linkUrl = isImageAssetUrl(candidate) ? "" : candidate;
  // The file name and asset path are SharePoint implementation detail —
  // they stay in the RAW master file. Only what a reader could actually
  // read or click on the page carries over.
  return caption || alt || overlay || linkUrl ? { type: "image", caption, alt, overlay, linkUrl } : null;
}

function agentLink(blob) {
  const title = text(blob?.properties?.webPartTitle);
  return title ? { type: "agent", title } : null;
}

// Anything without a dedicated extractor still surrenders whatever
// SharePoint itself marked as searchable text or as a link, so an
// unrecognized web part can never make content silently disappear.
function generic(blob) {
  const spt = blob?.serverProcessedContent?.searchablePlainTexts || {};
  const links = blob?.serverProcessedContent?.links || {};
  const texts = Object.entries(spt).filter(([k]) => k !== "title").map(([, v]) => text(v)).filter(Boolean);
  const urls = Object.entries(links)
    .filter(([k, v]) => k !== "baseUrl" && !isImageAssetUrl(v))
    .map(([, v]) => text(v))
    .filter(Boolean);
  const title = text(spt.title);
  // A title-only part is still content: Home.aspx's News web part
  // carries nothing but "Company News & Announcements", and requiring
  // body text discarded that heading entirely.
  if (!texts.length && !urls.length && !title) return null;
  return { type: "other", title, texts, urls };
}

const EXTRACTORS = {
  [QUICK_LINKS_ID]: quickLinks,
  [PEOPLE_ID]: people,
  [IMAGE_ID]: image,
  [AGENT_LINK_ID]: agentLink,
};

function webPartContent(blob) {
  if (!blob) return null;
  const fn = EXTRACTORS[blob.id];
  return fn ? fn(blob) : generic(blob);
}

/* ---------------- page ---------------- */

// The site URL SharePoint itself recorded in a Quick Links web part.
// Never derived from the filename — an absent baseUrl stays absent
// rather than becoming a guessed URL.
function siteBaseUrl(doc) {
  let relative = "";
  for (const el of doc.querySelectorAll("[data-sp-webpartdata]")) {
    const base = text(json(el, "data-sp-webpartdata")?.serverProcessedContent?.links?.baseUrl);
    if (!base) continue;
    if (/^https?:\/\//i.test(base)) return base;
    relative ||= base;
  }
  return relative;
}

export function parseCanvas(canvasHtml) {
  return new DOMParser().parseFromString(`<body>${canvasHtml}</body>`, "text/html");
}

// Returns the decoded canvas exactly as buildSection writes it into the
// RAW master file — one entity pass — so both representations are built
// from an identical starting string.
export function canvasHtmlOf(rawAspx) {
  return decodeOnce(extractTag(rawAspx, "CanvasContent1"));
}

export function parsePage(rawAspx, { name = "", path = "" } = {}) {
  const canvasHtml = canvasHtmlOf(rawAspx);
  const doc = parseCanvas(canvasHtml);
  const sections = [];

  for (const el of doc.querySelectorAll("[data-sp-canvascontrol]")) {
    const controlData = json(el, "data-sp-controldata") || {};
    if (controlData.controlType === CONTROL_TEXT) {
      const rte = el.querySelector("[data-sp-rte]");
      if (!rte) continue;
      const blocks = collectBlocks(rte);
      if (blocks.length) sections.push({ kind: "text", blocks });
    } else if (controlData.controlType === CONTROL_WEBPART) {
      const content = webPartContent(json(el.querySelector("[data-sp-webpartdata]") || el, "data-sp-webpartdata"));
      if (content) sections.push({ kind: "webpart", content });
    }
    // controlType 0 is the page settings slice — no user-visible content.
  }

  return {
    name,
    path,
    canvasHtml,
    sections,
    metadata: {
      contentTypeId: extractTag(rawAspx, "ContentTypeId").trim(),
      pageLayoutType: extractTag(rawAspx, "PageLayoutType").trim(),
      topicHeader: decodeOnce(extractTag(rawAspx, "_TopicHeader")).trim(),
      authorByline: decodeOnce(extractTag(rawAspx, "_AuthorByline")).trim(),
      siteBaseUrl: siteBaseUrl(doc),
    },
  };
}
