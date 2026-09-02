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
 *
 * Matching is token-based, not substring-based. A corpus run found a
 * page that lost its "LEASING" and "PROJECT DEVELOPMENT" section
 * headings yet still passed, because those strings occur inside
 * "subleasing/assignment" and inside a person's "Project Development
 * Specialist" role elsewhere on the page. Character-level `includes()`
 * cannot tell a real occurrence from an accidental one, so the unit of
 * comparison here is a run of whole tokens, and each unit must claim
 * its own tokens — see coverage.js.
 * ------------------------------------------------------------------ */

import { decodeEntitiesOnce, isImageAssetUrl } from "./webparts.js";

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

// Whole-token comparison is what stops a short unit from being "found"
// inside an unrelated longer word. Edge punctuation is trimmed so a
// trailing period or comma never breaks a match, but internal
// punctuation is kept — it is what holds emails, decimals, currency
// amounts and URLs together as single tokens.
export function tokenize(s) {
  return normalize(s)
    .split(" ")
    .map((t) => t.replace(/^[.,;:!?'"/-]+|[.,;:!?'"/-]+$/g, ""))
    .filter((t) => t && /[\p{L}\p{N}]/u.test(t));
}

function meaningful(s) {
  return tokenize(s).length ? String(s).trim() : "";
}

function addUnits(target, values) {
  for (const v of values) {
    const kept = meaningful(v);
    if (!kept) continue;
    const key = tokenize(kept).join(" ");
    if (!target.has(key)) target.set(key, kept);
  }
}

/* ---------------- source side ---------------- */

// Splitting on BOTH opening and closing block tags. Closing tags alone
// missed `<li>Consultant<ul>…` — the bare text and the nested list's
// first item fused into one unit that no correctly-rendered document
// could contain, producing a false failure.
// Anchors are boundaries too: the renderer lifts a link out of its
// surrounding prose into [label](href), so the prose either side and
// the label are separate runs in the output. Segmenting the source the
// same way keeps both sides comparable instead of demanding that the
// output hold the paragraph as one uninterrupted run.
const BLOCK_BOUNDARY =
  /<\/?(p|div|h[1-6]|li|ul|ol|tr|td|th|table|blockquote|section|article|br|a)\b[^>]*>/gi;

// Anchor targets are meaningful content the reader can act on, and the
// renderer emits them, so they are harvested as their own units rather
// than being thrown away with the tags. Without this the href path is
// unvalidated: the renderer could stop emitting URLs and nothing would
// notice.
function anchorHrefs(innerHtml) {
  const out = [];
  for (const m of innerHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeEntitiesOnce(m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (href && !/^javascript:/i.test(href) && !/^#/.test(href)) out.push(href);
  }
  return out;
}

// Independent of collectBlocks(): splits on markup boundaries rather
// than walking a parsed tree.
function rteLines(innerHtml) {
  return decodeEntitiesOnce(
    innerHtml
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(BLOCK_BOUNDARY, "\n")
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
  for (const [k, v] of Object.entries(spc.links || {})) {
    if (k === "baseUrl" || isImageAssetUrl(v)) continue;
    out.push(decodeEntitiesOnce(String(v)));
  }
  const p = blob?.properties || {};
  for (const k of ["captionText", "altText", "overlayText", "webPartTitle", "linkUrl", "title"]) {
    if (typeof p[k] === "string" && !isImageAssetUrl(p[k])) out.push(decodeEntitiesOnce(p[k]));
  }
  for (const person of p.persons || []) if (person?.role) out.push(decodeEntitiesOnce(String(person.role)));
  return out;
}

// Structural pairs the renderer joins onto one line: a link's label with
// its target, a person's name with their email. Keeping them together is
// what stops a phone number attaching to the wrong person or a URL to the
// wrong label — an association a token-presence check cannot see.
function webPartPairs(blob) {
  const spt = blob?.serverProcessedContent?.searchablePlainTexts || {};
  const links = blob?.serverProcessedContent?.links || {};
  const pairs = [];
  for (const [key, value] of Object.entries(spt)) {
    const link = key.match(/^items\[(\d+)\]\.title$/);
    if (link) {
      const url = links[`items[${link[1]}].sourceItem.url`];
      if (url && !isImageAssetUrl(url)) pairs.push([String(value), String(url)]);
      continue;
    }
    const person = key.match(/^persons\[(\d+)\]\.name$/);
    if (person) {
      const email = spt[`persons[${person[1]}].email`];
      if (email) pairs.push([String(value), String(email)]);
    }
  }
  return pairs.map(([a, b]) => [decodeEntitiesOnce(a), decodeEntitiesOnce(b)]);
}

// Walks the canvas in document order so that source order is reading
// order. Harvesting all RTE blocks and then all web parts (the previous
// shape) made the sequence meaningless for an ordering check, because the
// rendered document interleaves them by canvas position.
//
// A group is one canvas control. RTE groups are `ordered` — their lines
// are prose a reader follows top to bottom. A web part is a record, so
// its fields carry no reading order and only the group as a whole is
// positioned.
//
// `doc` is a parsed canvas document (see aspxDocument.parseCanvas).
export function sourceModel(doc) {
  const units = new Map(); // token-key -> original text, deduped
  const groups = [];
  const pairs = [];
  const seen = new Set();

  const keysFor = (values) => {
    const before = new Set(units.keys());
    addUnits(units, values);
    // Every key these values map to, whether newly added or already
    // present from a duplicate elsewhere on the page.
    return values.map((v) => tokenize(v).join(" ")).filter((k) => k && (units.has(k) || before.has(k)));
  };

  const harvest = (el) => {
    for (const rte of el.querySelectorAll("[data-sp-rte]")) {
      if (seen.has(rte)) continue;
      seen.add(rte);
      // Prose lines carry reading order; anchor targets do not — the
      // renderer places each href inline where its link sits, while
      // these are harvested after the text. Only the prose is ordered.
      const proseKeys = keysFor(rteLines(rte.innerHTML));
      const hrefKeys = keysFor(anchorHrefs(rte.innerHTML));
      const keys = [...proseKeys, ...hrefKeys];
      if (keys.length) groups.push({ kind: "rte", ordered: true, keys, orderedKeys: proseKeys });
    }
    for (const wp of el.querySelectorAll("[data-sp-webpartdata]")) {
      if (seen.has(wp)) continue;
      seen.add(wp);
      let blob = null;
      try { blob = JSON.parse(wp.getAttribute("data-sp-webpartdata")); } catch { continue; }
      const keys = keysFor(webPartValues(blob));
      if (keys.length) groups.push({ kind: "webpart", ordered: false, keys, orderedKeys: [] });
      for (const [a, b] of webPartPairs(blob)) {
        const ka = tokenize(a).join(" "), kb = tokenize(b).join(" ");
        if (ka && kb && units.has(ka) && units.has(kb)) pairs.push([ka, kb]);
      }
    }
  };

  for (const control of doc.querySelectorAll("[data-sp-canvascontrol]")) harvest(control);
  harvest(doc.body || doc); // anything outside a canvas control

  return { units, groups, pairs };
}

export function sourceUnits(doc) {
  return sourceModel(doc).units;
}

/* ---------------- rendered side ---------------- */

// The rendered document's own lines are the match targets. Bullet and
// ordered-list markers are stripped because they are the renderer's
// scaffolding, not content.
//
// The "## Source" block is excluded as provenance metadata rather than
// page content.
export function renderedLines(md) {
  const lines = md.split("\n");
  // Find the provenance block by normalizing rather than by matching
  // "## Source" literally. A changed heading depth, a doubled space, a
  // blockquote prefix or a non-breaking space all defeat a literal match
  // and turn the block into apparent content. It is always the last such
  // heading the renderer emits.
  const cut = lines.map((l) => normalize(l)).lastIndexOf("source");
  const body = cut >= 0 ? lines.slice(0, cut) : lines;
  return body
    // List markers are the renderer's scaffolding, not content. Emphasis
    // may sit outside the marker ("**1. Prepare…**"), so leading
    // quote/emphasis characters are consumed first — otherwise the bare
    // "1" survives tokenization and reads as content the source never had.
    .map((line) => line.replace(/^\s*(?:[>*_`~]+\s*)*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export function derivedTitleLine(pageName) {
  return pageName ? `# ${pageName.replace(/\.aspx$/i, "")}` : null;
}
