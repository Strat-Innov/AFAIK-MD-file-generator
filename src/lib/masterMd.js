/* ------------------------------------------------------------------ *
 * RAW / MASTER representation — the fidelity layer.
 *
 * Moved verbatim out of App.jsx so the fidelity guarantee can be
 * asserted by tests (test/masterMd.test.js). The output of
 * buildMaster() is byte-for-byte what it was when these functions
 * lived in the component: the transform rules below were
 * reverse-engineered from JUNE_13_Master_File.md and verified
 * consistent across all 121 sections, so nothing here changes
 * without a deliberate decision to change the master file format.
 *
 *   per .aspx: raw fence + ContentTypeId + PageLayoutType +
 *   CanvasContent1 decoded exactly ONE html-entity pass.
 *
 * Note: decodeOnce() deliberately uses a textarea rather than the
 * pure decoder in webparts.js. The textarea resolves the full HTML
 * named-entity table; webparts.js decodeEntitiesOnce() knows only six
 * named entities. Swapping one for the other would silently drop
 * characters from the master file — a fidelity regression.
 * ------------------------------------------------------------------ */

export function decodeOnce(s) {
  if (!s) return "";
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

export function extractTag(raw, tag) {
  const m = raw.match(new RegExp(`<mso:${tag}[^>]*>([\\s\\S]*?)</mso:${tag}>`));
  return m ? m[1] : "";
}

export function buildSection(name, path, raw) {
  const ctid = extractTag(raw, "ContentTypeId");
  const layout = extractTag(raw, "PageLayoutType");
  const canvas = decodeOnce(extractTag(raw, "CanvasContent1"));
  return (
    `\n---\n## ${name}\n` +
    `Path: ${path}\n` +
    `Type: aspx-web-file\n` +
    `---\n` +
    "```aspx\n" + raw + "\n```\n" +
    `### Project Specifications\n\n` +
    `### Content Overview\n\n` +
    `${ctid}\n${layout}\n${canvas}\n`
  );
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildMaster(bucketName, files, now = new Date()) {
  const sorted = [...files].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  let md =
    `# ${bucketName} — ASPx Codebase Master File\n` +
    `Generated on: ${stamp(now)}\n` +
    `Total Files: ${sorted.length}\n\n` +
    `## Table of Contents\n` +
    sorted.map((f) => `* [${f.name}](__#)`).join("\n") +
    `\n`;
  for (const f of sorted) md += buildSection(f.name, f.path, f.raw);
  return md;
}
