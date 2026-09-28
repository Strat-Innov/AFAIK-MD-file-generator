/* ------------------------------------------------------------------ *
 * Minimal XLSX reader — first worksheet to a grid of strings.
 *
 * An .xlsx file is a ZIP of XML parts, and the app already reads ZIPs
 * with the browser's native DecompressionStream, so this needs no
 * dependency. It is deliberately a separate reader from readZip() in
 * App.jsx: that one belongs to the frozen ASPx path and filters to
 * .aspx entries, and it stays untouched.
 *
 * Scope: cell values only (shared strings, inline strings, formula
 * results, numbers, booleans). No styles, so a date stored as a serial
 * number comes back as that number; the import layer interprets the
 * one date column it knows about. Legacy binary .xls is out of scope.
 * ------------------------------------------------------------------ */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// Reader loop rather than Response/Blob.stream(): those are only partly
// implemented under jsdom (same reasoning as src/lib/zip.js).
async function inflateRaw(bytes) {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Map of entry name -> async () => text, for every file in the archive. */
export function listZipEntries(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP directory found).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    entries.set(name, async () => {
      if (dv.getUint32(lho, true) !== SIG_LOCAL) throw new Error(`Corrupt .xlsx entry: ${name}`);
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const comp = u8.subarray(start, start + compSize);
      let bytes;
      if (method === 0) bytes = comp;
      else if (method === 8) bytes = await inflateRaw(comp);
      else throw new Error(`Unsupported compression in .xlsx entry: ${name}`);
      return new TextDecoder("utf-8").decode(bytes);
    });
  }
  return entries;
}

function parseXml(text, part) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(`Malformed XML in .xlsx part ${part}.`);
  return doc;
}

// Namespace-agnostic: files written by different tools prefix the
// SpreadsheetML namespace differently (none, "x:", …).
const all = (node, local) => [...node.getElementsByTagNameNS("*", local)];
const first = (node, local) => node.getElementsByTagNameNS("*", local)[0] ?? null;

// Text of a string item: plain <t>, or the runs of rich text. Phonetic
// guides (<rPh>) are annotations, not content, and are skipped.
function stringItemText(si) {
  return all(si, "t")
    .filter((t) => t.parentNode?.localName !== "rPh")
    .map((t) => t.textContent)
    .join("");
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase();
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function firstSheetPath(entries) {
  const wb = entries.get("xl/workbook.xml");
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const sheet = first(parseXml(await wb(), "workbook.xml"), "sheet");
    const rid = sheet?.getAttribute("r:id") ??
      sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    if (rid) {
      const rel = all(parseXml(await rels(), "workbook.xml.rels"), "Relationship").find((r) => r.getAttribute("Id") === rid);
      const target = rel?.getAttribute("Target");
      if (target) {
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        if (entries.has(path)) return { path, name: sheet.getAttribute("name") ?? "" };
      }
    }
  }
  const fallback = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!fallback) throw new Error("No worksheet found in this .xlsx file.");
  return { path: fallback, name: "" };
}

/**
 * @returns {Promise<{ rows: string[][], sheetName: string }>}
 */
export async function readXlsx(arrayBuffer) {
  const entries = listZipEntries(arrayBuffer);

  const shared = [];
  const sst = entries.get("xl/sharedStrings.xml");
  if (sst) for (const si of all(parseXml(await sst(), "sharedStrings.xml"), "si")) shared.push(stringItemText(si));

  const { path, name } = await firstSheetPath(entries);
  const sheet = parseXml(await entries.get(path)(), path);

  const rows = [];
  for (const r of all(sheet, "row")) {
    const cells = [];
    let next = 0;
    for (const c of all(r, "c")) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) ?? next : next;
      next = col + 1;
      const type = c.getAttribute("t");
      const v = first(c, "v")?.textContent ?? "";
      let value;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = first(c, "is") ? stringItemText(first(c, "is")) : "";
      else if (type === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
      else value = v; // n, str (formula result), e (error text), or untyped
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    if (cells.some((x) => x !== "")) rows.push(cells);
  }
  return { rows, sheetName: name };
}
