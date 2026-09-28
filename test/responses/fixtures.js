/* Synthetic AFAIK session exports for the Response Consolidator tests.
 *
 * Invented content only. Real exports hold real employee conversations
 * and this repository is public, so they stay local (gitignored) — see
 * test/responses/README.md. The shapes below mirror the real export:
 * the same 13 columns, a semicolon-separated ChatTranscript with
 * "User says:" / "Agent says:" / "Bot said:" speakers, multi-line
 * answers with Markdown tables, URLs and doubled quotes. */

import { createZip } from "../../src/lib/zip.js";

export const HEADERS = [
  "SessionId", "StartDateTime(UTC)", "SessionOutcome", "OutcomeReason", "IsResolvedImplied", "Turns",
  "ChatTranscript", "InitialUserMessage", "TopicName", "TopicId", "Channel", "CSAT", "Comments",
];

const q = (v) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows, headers = HEADERS, eol = "\r\n") =>
  [headers, ...rows].map((r) => r.map((c) => q(String(c))).join(",")).join(eol) + eol;

export const MULTI_QUESTION_TRANSCRIPT =
  "Agent says: Hello, I'm AFAIK. How can I help?;" +
  "User says: give me oms for operations;" +
  "Agent says: Here are the direct links to the OMS Documents for Operations:\n\n" +
  "| Document | Link |\n|---|---|\n| Operations OMS | https://example.test/sites/ops/OMS.pdf |\n\n" +
  "Let me know if you need anything else.;" +
  "User says: give me the links;" +
  "Agent says: Here you go: https://example.test/sites/ops/OMS.pdf;" +
  "User says: give me the links for operations OMS;" +
  "Agent says: The Operations OMS is at https://example.test/sites/ops/OMS.pdf — it was titled \"OMS v2\".";

export const NOT_FOUND_TRANSCRIPT =
  "User says: 1-BR Unit price at Sample Station Terminal;" +
  "Agent says: I'm sorry, that information is not available in the configured knowledge source.";

export const UNAVAILABLE_TRANSCRIPT =
  "Bot said: This agent is currently unavailable. It has reached its usage limit.";

export const ROWS = [
  ["sess-001", "2026-09-23 03:14:05", "Resolved", "Resolved", "True", "4",
    MULTI_QUESTION_TRANSCRIPT, "give me oms for operations", "Conversational boosting", "t-1", "msteams", "5", ""],
  ["sess-002", "9/23/2026 4:05:00 PM", "Abandoned", "UserExit", "False", "1",
    NOT_FOUND_TRANSCRIPT, "1-BR Unit price at Sample Station Terminal", "Conversational boosting", "t-1", "msteams", "", "no price"],
  ["sess-003", "2026-09-22T08:00:00Z", "Escalated", "AgentUnavailable", "False", "0",
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
