/* ------------------------------------------------------------------ *
 * Extracts structured content from known SharePoint web parts embedded
 * in an .aspx page's CanvasContent1 (data-sp-webpartdata="...") so it
 * can be diffed between generations. Deterministic, no AI involved —
 * only web part types in REGISTRY are understood; anything else is
 * silently skipped (not an error — most pages have unrecognized parts
 * too, like Image or Agent link, and that's fine).
 * ------------------------------------------------------------------ */

const PEOPLE_ID = "7f718435-ee4d-431c-bdbf-9c4ff326f46e";
const QUICK_LINKS_ID = "c70391ea-0b10-4ee9-b2b4-006d3fcad0cd";

const NAMED_ENTITIES = { amp: "&", quot: '"', lt: "<", gt: ">", apos: "'", nbsp: "\u00A0" };

function decodeEntitiesOnce(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

// The blob is escaped exactly twice: once as a JS-export layer, once as
// an HTML attribute value — verified against a real exported .aspx file.
function decodeEntities(s, times = 2) {
  let out = s;
  for (let i = 0; i < times; i++) out = decodeEntitiesOnce(out);
  return out;
}

function extractWebPartBlobs(rawAspx) {
  const blobs = [];
  const re = /data-sp-webpartdata=&quot;([\s\S]*?)&quot;&gt;/g;
  let m;
  while ((m = re.exec(rawAspx))) {
    try {
      blobs.push(JSON.parse(decodeEntities(m[1])));
    } catch {
      // Not parseable at this encoding depth — skip this one part, not the whole file.
    }
  }
  return blobs;
}

function extractPeople(blob) {
  const persons = blob?.properties?.persons || [];
  const names = blob?.serverProcessedContent?.searchablePlainTexts || {};
  return persons.map((p, i) => ({
    key: p.id || `persons[${i}]`,
    label: `${names[`persons[${i}].name`] || p.id}${p.role ? ` — ${p.role}` : ""}`,
  }));
}

function extractQuickLinks(blob) {
  const names = blob?.serverProcessedContent?.searchablePlainTexts || {};
  const urls = blob?.serverProcessedContent?.links || {};
  const items = blob?.properties?.items || [];
  return items.map((_, i) => {
    const url = urls[`items[${i}].sourceItem.url`];
    const title = names[`items[${i}].title`] || "Untitled link";
    return { key: url || `items[${i}]`, label: url ? `${title} (${url})` : title };
  });
}

const REGISTRY = {
  [PEOPLE_ID]: { label: "People", extract: extractPeople },
  [QUICK_LINKS_ID]: { label: "Quick links", extract: extractQuickLinks },
};

// [{ instanceId, label, items: [{key, label}] }] for every recognized web
// part found in this file. Unrecognized web part types are left out.
export function extractStructuredContent(rawAspx) {
  return extractWebPartBlobs(rawAspx)
    .filter((blob) => REGISTRY[blob.id])
    .map((blob) => ({
      instanceId: blob.instanceId,
      label: blob.title || REGISTRY[blob.id].label,
      items: REGISTRY[blob.id].extract(blob),
    }));
}

// Compares two files' extracted web parts (matched by instanceId, since
// that's what stays stable across edits of the same web part instance).
// Returns [] if nothing changed.
export function diffStructuredContent(prevParts, currentParts) {
  const prevByInstance = Object.fromEntries((prevParts || []).map((p) => [p.instanceId, p]));
  const changes = [];
  for (const part of currentParts) {
    const prevPart = prevByInstance[part.instanceId];
    const prevKeys = new Set((prevPart?.items || []).map((i) => i.key));
    const currKeys = new Set(part.items.map((i) => i.key));
    const added = part.items.filter((i) => !prevKeys.has(i.key));
    const removed = (prevPart?.items || []).filter((i) => !currKeys.has(i.key));
    if (added.length || removed.length) changes.push({ label: part.label, added, removed });
  }
  return changes;
}
