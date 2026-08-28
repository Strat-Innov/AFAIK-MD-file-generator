/* ------------------------------------------------------------------ *
 * Content units — the shared primitive behind the validation gate.
 *
 * A "unit" is one atomic piece of user-visible information: a line of
 * prose, a list item, a table cell, a price, a link URL, a person's
 * name. Coverage is measured in units, so the gate can name exactly
 * which value went missing instead of returning a bare boolean.
 *
 * IMPORTANT — sourceUnits() deliberately does NOT reuse the block
 * parser in aspxDocument.js. It re-derives the source's content by a
 * different technique (tag-boundary splitting on the raw RTE markup,
 * plus a whitelist harvest of the web part JSON). If the parser ever
 * drops a paragraph, the gate still sees it and fails the publish. A
 * validator that shares its extraction with the thing it validates
 * cannot detect that class of bug at all.
 * ------------------------------------------------------------------ */

import { decodeEntitiesOnce } from "./webparts.js";

/* ---------------- normalization ---------------- */

// Tolerates formatting differences — Markdown syntax, whitespace, HTML
// line breaks, quote/dash variants, non-breaking spaces — while leaving
// factual values (numbers, currency, units, URLs) intact.
export function normalize(s) {
  return String(s)
    .normalize("NFKC")
    .replace(/[   ]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*_`~#>|\\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A unit that normalizes to nothing, or to punctuation only, carries no
// information and must not be counted on either side of the comparison.
function meaningful(s) {
  const n = normalize(s);
  return n && /[\p{L}\p{N}]/u.test(n) ? n : "";
}

function addUnits(target, values) {
  for (const v of values) {
    const n = meaningful(v);
    if (n && !target.has(n)) target.set(n, String(v).trim());
  }
}

/* ---------------- source side ---------------- */

const BLOCK_CLOSE = /<\/(p|div|h[1-6]|li|ul|ol|tr|td|th|blockquote|section|article)\s*>/gi;
const BR = /<br\s*\/?>/gi;

// Independent of collectBlocks(): splits on markup boundaries rather
// than walking a parsed tree.
function rteLines(innerHtml) {
  return decodeEntitiesOnce(
    innerHtml
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(BR, "\n")
      .replace(BLOCK_CLOSE, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// Only what SharePoint itself designates as readable content. Notably
// excluded: imageSources, fileName, siteId/webId/listId/uniqueId,
// controldata positions, htmlproperties — rendering and implementation
// detail with no user-facing meaning.
function webPartValues(blob) {
  const out = [];
  const spc = blob?.serverProcessedContent || {};
  for (const v of Object.values(spc.searchablePlainTexts || {})) out.push(decodeEntitiesOnce(String(v)));
  for (const [k, v] of Object.entries(spc.links || {})) if (k !== "baseUrl") out.push(decodeEntitiesOnce(String(v)));
  const p = blob?.properties || {};
  for (const k of ["captionText", "altText", "overlayText", "webPartTitle", "linkUrl", "title"]) {
    if (typeof p[k] === "string") out.push(decodeEntitiesOnce(p[k]));
  }
  for (const person of p.persons || []) if (person?.role) out.push(decodeEntitiesOnce(String(person.role)));
  return out;
}

// `doc` is a parsed canvas document (see aspxDocument.parseCanvas).
export function sourceUnits(doc) {
  const units = new Map(); // normalized -> original, deduped
  for (const rte of doc.querySelectorAll("[data-sp-rte]")) addUnits(units, rteLines(rte.innerHTML));
  for (const el of doc.querySelectorAll("[data-sp-webpartdata]")) {
    let blob = null;
    try { blob = JSON.parse(el.getAttribute("data-sp-webpartdata")); } catch { continue; }
    addUnits(units, webPartValues(blob));
  }
  return units;
}

/* ---------------- rendered side ---------------- */

// The only joins the renderer performs are Markdown link syntax, the
// " — " separator in a person line, and table pipes. Splitting those
// back apart is what lets an emitted line be traced to the source
// values it was built from.
export function renderedFragments(md) {
  const withoutSource = md.replace(/\n## Source\n[\s\S]*$/, "\n");
  return withoutSource
    .split("\n")
    .flatMap((line) => line.replace(/\]\(/g, "\n").split(/\n| — |\|/))
    .map((f) => f.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
    .filter(Boolean);
}
