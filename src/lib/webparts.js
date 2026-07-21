/* ------------------------------------------------------------------ *
 * Extracts structured content from SharePoint web parts embedded in an
 * .aspx page's CanvasContent1 (data-sp-webpartdata="...") so it can be
 * diffed between generations. Deterministic, no AI involved. Three
 * tiers of coverage, so nothing is silently invisible to the
 * changelog even if we haven't reverse-engineered its exact schema:
 *   - "list"    (People, Quick Links)   — item-level added/removed
 *   - "fields"  (Image, Agent link)     — field-level "changed from/to"
 *   - "generic" (anything else)         — content-hash based "changed",
 *                                          no item-level detail
 * ------------------------------------------------------------------ */

const PEOPLE_ID = "7f718435-ee4d-431c-bdbf-9c4ff326f46e";
const QUICK_LINKS_ID = "c70391ea-0b10-4ee9-b2b4-006d3fcad0cd";
const IMAGE_ID = "d1d91016-032f-456d-98a4-721247c305e8";
const AGENT_LINK_ID = "f82072bb-4968-4341-b99b-d450fc52ec2f";

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

/* ---- "list" kind: People, Quick Links ---- */

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

/* ---- "fields" kind: Image, Agent link ---- */

function extractImageFields(blob) {
  const p = blob?.properties || {};
  return {
    fileName: p.fileName || "",
    caption: p.captionText || "",
    altText: p.altText || "",
    linkUrl: p.linkUrl || "",
    imageSource: blob?.serverProcessedContent?.imageSources?.imageSource || "",
  };
}

function extractAgentLinkFields(blob) {
  const p = blob?.properties || {};
  return {
    title: p.webPartTitle || "",
    agentName: p.selectedAgentPickerItem?.name || "",
    agentAuthor: p.selectedAgentPickerItem?.author || "",
  };
}

const REGISTRY = {
  [PEOPLE_ID]: { type: "people", label: "People", kind: "list", extract: extractPeople },
  [QUICK_LINKS_ID]: { type: "quicklinks", label: "Quick links", kind: "list", extract: extractQuickLinks },
  [IMAGE_ID]: { type: "image", label: "Image", kind: "fields", extract: extractImageFields },
  [AGENT_LINK_ID]: { type: "agentlink", label: "Agent link", kind: "fields", extract: extractAgentLinkFields },
};

// Canonical type list for the visibility toggle UI — stable identifiers,
// independent of a web part's (customizable) display title.
export const WEBPART_TYPES = [
  ...Object.values(REGISTRY).map((r) => ({ type: r.type, label: r.label })),
  { type: "generic", label: "Other content" },
];

// Small, non-cryptographic fingerprint — just needs to change when the
// content changes, not to resist tampering.
function fingerprint(value) {
  const str = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// One entry per web part found in the file — recognized types get real
// structured data; anything else still gets tracked via a content hash
// so it's never silently invisible to the changelog.
export function extractStructuredContent(rawAspx) {
  return extractWebPartBlobs(rawAspx).map((blob, i) => {
    const reg = blob?.id && REGISTRY[blob.id];
    if (reg) {
      return { instanceId: blob.instanceId || `part-${i}`, label: blob.title || reg.label, type: reg.type, kind: reg.kind, data: reg.extract(blob) };
    }
    return { instanceId: blob?.instanceId || `unrecognized-${i}`, label: blob?.title || "Other content", type: "generic", kind: "generic", data: fingerprint(blob) };
  });
}

// Compares two files' extracted web parts (matched by instanceId, since
// that's what stays stable across edits of the same web part instance).
// Returns [] if nothing changed.
export function diffStructuredContent(prevParts, currentParts) {
  const prevByInstance = Object.fromEntries((prevParts || []).map((p) => [p.instanceId, p]));
  const changes = [];

  for (const part of currentParts) {
    const prevPart = prevByInstance[part.instanceId];

    if (part.kind === "list") {
      const prevKeys = new Set((prevPart?.data || []).map((i) => i.key));
      const currKeys = new Set(part.data.map((i) => i.key));
      const added = part.data.filter((i) => !prevKeys.has(i.key));
      const removed = (prevPart?.data || []).filter((i) => !currKeys.has(i.key));
      if (added.length || removed.length) changes.push({ label: part.label, type: part.type, kind: "list", added, removed });
    } else if (part.kind === "fields") {
      const prevFields = prevPart?.data || {};
      const fieldChanges = [];
      for (const key of Object.keys(part.data)) {
        const to = part.data[key];
        if (!to) continue; // empty field, nothing to report
        if (!prevPart) fieldChanges.push({ field: key, from: null, to });
        else if (prevFields[key] !== to) fieldChanges.push({ field: key, from: prevFields[key] || "(empty)", to });
      }
      if (fieldChanges.length) changes.push({ label: part.label, type: part.type, kind: "fields", fieldChanges });
    } else {
      if (!prevPart || prevPart.data !== part.data) changes.push({ label: part.label, type: part.type, kind: "generic" });
    }
  }

  return changes;
}
