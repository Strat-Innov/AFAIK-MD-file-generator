/* Synthetic AFAIK session exports for the Response Consolidator tests.
 *
 * Invented content only. Real exports hold real employee conversations
 * and this repository is public, so they stay local (gitignored) — see
 * test/responses/README.md. The shapes below mirror the real export:
 * the same 13 columns and the ChatTranscript structure described
 * below. */

import { createZip } from "../../src/lib/zip.js";

export const HEADERS = [
  "SessionId", "StartDateTime(UTC)", "SessionOutcome", "OutcomeReason", "IsResolvedImplied", "Turns",
  "ChatTranscript", "InitialUserMessage", "TopicName", "TopicId", "Channel", "CSAT", "Comments",
];

const q = (v) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows, headers = HEADERS, eol = "\r\n") =>
  [headers, ...rows].map((r) => r.map((c) => q(String(c))).join(",")).join(eol) + eol;

/* Transcript shape, from the real exports (scripts/analyze-session-exports.mjs):
 * every entry is "<Speaker> says: <text>;" — one space after the colon,
 * a ";" terminating every entry including the last, no separator
 * between entries, no line breaks (Markdown is flattened onto one
 * line). Only "User says" and "Agent says" occur; "Bot said:" appears
 * only inside an Agent entry's text. The Turns column counts entries. */
export const tx = (...entries) => entries.map(([who, text]) => `${who} says: ${text};`).join("");

export const GREETING = "Hi! I'm **AFAIK AGENT** your virtual assistant. How can I help?";
export const UNAVAILABLE_NOTICE = "This agent is currently unavailable. It has reached its usage limit. Please try again later.";
// The exporter cuts messages at ~500 characters and appends "...".
export const TRUNCATED_ANSWER =
  ("Based on the configured knowledge source here are the **Operations OMS** documents: " +
    "- **OMS Volume 1** https://example.test/sites/ops/Shared%20Documents/OMS-1.pdf ").repeat(4).slice(0, 497) + "...";

export const MULTI_QUESTION_TRANSCRIPT = tx(
  ["Agent", GREETING],
  ["User", "give me oms for operations"],
  ["Agent", "Here are the direct links to the OMS Documents for Operations: - **Operations OMS**: https://example.test/sites/ops/OMS.pdf"],
  ["User", "give me the links"],
  ["Agent", "Here you go: https://example.test/sites/ops/OMS.pdf"],
  ["User", "give me the links for operations OMS"],
  ["Agent", 'The Operations OMS is at https://example.test/sites/ops/OMS.pdf — it was titled "OMS v2".'],
);

export const NOT_FOUND_TRANSCRIPT = tx(
  ["User", "1-BR Unit price at Sample Station Terminal"],
  ["Agent", "I'm sorry but **this information is not available in the configured knowledge source**."],
);

export const UNAVAILABLE_TRANSCRIPT = tx(["Agent", GREETING], ["Agent", UNAVAILABLE_NOTICE]);

// Not the real transcript shape — kept to prove the CSV reader copes
// with quoted multi-line cells, which other exports may still contain.
export const MULTILINE_CELL = "line one; with a semicolon\n\n| a | b |\n|---|---|\n| \"quoted\" | 2 |";

export const ROWS = [
  ["sess-001", "2026-09-23 03:14:05", "Resolved", "Resolved", "True", "7",
    MULTI_QUESTION_TRANSCRIPT, "give me oms for operations", "Conversational boosting", "t-1", "msteams", "5", ""],
  ["sess-002", "9/23/2026 4:05:00 PM", "Abandoned", "UserExit", "False", "2",
    NOT_FOUND_TRANSCRIPT, "1-BR Unit price at Sample Station Terminal", "Conversational boosting", "t-1", "msteams", "", "no price"],
  ["sess-003", "2026-09-22T08:00:00Z", "Escalated", "AgentUnavailable", "False", "2",
    UNAVAILABLE_TRANSCRIPT, "", "", "", "webchat", "", ""],
];

export const fileFrom = (name, content) => {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i) => String.fromCharCode(65 + i);

/* Builds a real .xlsx with the app's own zip writer — shared strings
 * for the header row, inline strings for data, one numeric cell, one
 * gap — so the reader is exercised on every cell kind it claims. */
export async function buildWorkbook(rows, { prefix = "" } = {}) {
  const shared = rows[0];
  const p = prefix ? `${prefix}:` : "";
  const ns = prefix ? `xmlns:${prefix}` : "xmlns";
  const sheetRows = rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      const ref = `${col(ci)}${ri + 1}`;
      if (v === "") return "";
      if (ri === 0) return `<${p}c r="${ref}" t="s"><${p}v>${ci}</${p}v></${p}c>`;
      if (/^\d+(\.\d+)?$/.test(v)) return `<${p}c r="${ref}"><${p}v>${v}</${p}v></${p}c>`;
      return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t xml:space="preserve">${esc(v)}</${p}t></${p}is></${p}c>`;
    }).join("");
    return `<${p}row r="${ri + 1}">${cells}</${p}row>`;
  }).join("");
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const entries = [
    { name: "[Content_Types].xml", text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "xl/workbook.xml", text: `<?xml version="1.0"?><workbook xmlns="${main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sessions" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/data.xml"/></Relationships>' },
    { name: "xl/sharedStrings.xml", text: `<?xml version="1.0"?><sst xmlns="${main}">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>` },
    { name: "xl/worksheets/data.xml", text: `<?xml version="1.0"?><${p}worksheet ${ns}="${main}"><${p}sheetData>${sheetRows}</${p}sheetData></${p}worksheet>` },
  ];
  const bytes = await createZip(entries);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
