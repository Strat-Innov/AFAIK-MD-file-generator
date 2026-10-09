/* ------------------------------------------------------------------ *
 * Minimal XLSX writer — several sheets of text and numbers.
 *
 * The app already writes ZIPs (src/lib/zip.js) and an .xlsx is a ZIP of
 * SpreadsheetML parts, so this needs no dependency. Scope is what the
 * exports need and no more: a bold, frozen header row, column widths,
 * wrapped text, strings and numbers.
 *
 * Strings are written as inline strings (t="inlineStr"), never as
 * formulas, so a cell that begins with "=" (a user can type anything
 * into a chat) is stored as text and cannot execute in Excel.
 *
 * Deterministic: the timestamp comes from the caller, so the same data
 * gives the same bytes.
 * ------------------------------------------------------------------ */

import { createZip } from "../../zip.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const EXCEL_CELL_LIMIT = 32767;

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

// Characters XML 1.0 cannot carry at all.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s) => s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function columnLetter(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const STYLE = { DEFAULT: 0, HEADER: 1, WRAP: 2 };

function cellXml(value, ref, style) {
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (value === null || value === undefined || value === "") return "";
  let text = String(value);
  if (text.length > EXCEL_CELL_LIMIT) {
    const note = " … [cut to fit Excel's cell limit]";
    text = text.slice(0, EXCEL_CELL_LIMIT - note.length) + note;
  }
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function sheetXml({ columns, rows }) {
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`).join("");
  const header = `<row r="1">${columns.map((c, i) => cellXml(c.header, `${columnLetter(i)}1`, STYLE.HEADER)).join("")}</row>`;
  const body = rows.map((row, ri) => {
    const r = ri + 2;
    return `<row r="${r}">${row.map((v, ci) => cellXml(v, `${columnLetter(ci)}${r}`, columns[ci]?.wrap ? STYLE.WRAP : STYLE.DEFAULT)).join("")}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/* Excel refuses sheet names over 31 characters or with []:*?/\ in them. */
function checkSheetName(name) {
  if (!name || name.length > 31 || /[[\]:*?/\\]/.test(name)) throw new Error(`Invalid Excel sheet name "${name}".`);
}

/**
 * @param sheets  [{ name, columns: [{ header, width?, wrap? }], rows: [[string|number|null]] }]
 * @param options.modifiedAt  stamped on the archive entries (reproducible)
 * @returns Promise<Uint8Array>  the .xlsx bytes
 */
export async function createXlsx(sheets, { modifiedAt = new Date(0) } = {}) {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet.");
  const names = new Set();
  for (const s of sheets) {
    checkSheetName(s.name);
    if (names.has(s.name.toLowerCase())) throw new Error(`Duplicate sheet name "${s.name}".`);
    names.add(s.name.toLowerCase());
  }

  const entries = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", text: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  return createZip(entries, { modifiedAt });
}
