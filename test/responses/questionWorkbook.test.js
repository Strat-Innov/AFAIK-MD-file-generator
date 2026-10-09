import { describe, it, expect } from "vitest";
import { listZipEntries } from "../../src/lib/responses/xlsx.js";
import { createXlsx, columnLetter } from "../../src/lib/responses/export/xlsxWriter.js";
import { buildQuestionSheets, exportQuestionWorkbook, answerCell, WORKBOOK_FILENAME } from "../../src/lib/responses/export/questionWorkbook.js";
import { consolidateQuestions } from "../../src/lib/responses/consolidate.js";
import { consolidationRecords } from "./fixtures.js";

/* An independent read of a written workbook: unzip, parse each part as
 * XML, and return every sheet as rows of cell values. */
async function readWorkbook(bytes) {
  const entries = listZipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const xml = async (name) => new DOMParser().parseFromString(await entries.get(name)(), "application/xml");
  const wb = await xml("xl/workbook.xml");
  const names = [...wb.getElementsByTagName("sheet")].map((s) => s.getAttribute("name"));
  const sheets = {};
  for (const [i, name] of names.entries()) {
    const doc = await xml(`xl/worksheets/sheet${i + 1}.xml`);
    const rows = [...doc.getElementsByTagName("row")].map((r) => [...r.getElementsByTagName("c")].map((c) => {
      const t = c.getAttribute("t");
      if (t === "inlineStr") return c.getElementsByTagName("t")[0].textContent;
      return Number(c.getElementsByTagName("v")[0].textContent);
    }));
    sheets[name] = { rows, frozen: doc.getElementsByTagName("pane")[0]?.getAttribute("state") === "frozen", types: [...doc.getElementsByTagName("c")].map((c) => c.getAttribute("t")) };
  }
  return { names, sheets, entries: [...entries.keys()] };
}

async function consolidated() {
  const records = await consolidationRecords();
  return { records, questions: consolidateQuestions(records), summary: { files: 1, sessions: 2 }, exportedAt: "2026-09-28T08:00:00.000Z" };
}

describe("XLSX writer", () => {
  it("names columns past Z the way Excel does", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes a readable multi-sheet workbook with a frozen header, text and numbers", async () => {
    const bytes = await createXlsx([
      { name: "One", columns: [{ header: "Text" }, { header: "Number" }], rows: [["a & <b>", 3], ["", 4.5]] },
      { name: "Two", columns: [{ header: "X" }], rows: [["line 1\nline 2"]] },
    ]);
    const wb = await readWorkbook(bytes);
    expect(wb.names).toEqual(["One", "Two"]);
    expect(wb.sheets.One.rows).toEqual([["Text", "Number"], ["a & <b>", 3], [4.5]]);
    expect(wb.sheets.One.frozen).toBe(true);
    expect(wb.sheets.Two.rows[1]).toEqual(["line 1\nline 2"]);
    expect(wb.entries).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/_rels/workbook.xml.rels"]));
  });

  it("stores a value that looks like a formula as text, never as a formula", async () => {
    const wb = await readWorkbook(await createXlsx([{ name: "S", columns: [{ header: "Q" }], rows: [["=HYPERLINK(\"http://x\")"]] }]));
    expect(wb.sheets.S.rows[1]).toEqual(["=HYPERLINK(\"http://x\")"]);
    expect(wb.sheets.S.types).not.toContain(null); // every cell typed; no bare <f> formula cells
  });

  it("drops characters XML cannot carry instead of writing a corrupt file", async () => {
    const wb = await readWorkbook(await createXlsx([{ name: "S", columns: [{ header: "Q" }], rows: [["bell\u0007 and tab\tkept"]] }]));
    expect(wb.sheets.S.rows[1]).toEqual(["bell and tab\tkept"]);
  });

  it("refuses sheet names Excel would reject", async () => {
    await expect(createXlsx([{ name: "a/b", columns: [], rows: [] }])).rejects.toThrow(/Invalid Excel sheet name/);
    await expect(createXlsx([{ name: "x".repeat(32), columns: [], rows: [] }])).rejects.toThrow(/Invalid Excel sheet name/);
  });

  it("is deterministic for the same data and timestamp", async () => {
    const make = () => createXlsx([{ name: "S", columns: [{ header: "Q" }], rows: [["a"]] }], { modifiedAt: new Date("2026-09-28T00:00:00Z") });
    expect(Buffer.from(await make()).equals(Buffer.from(await make()))).toBe(true);
  });
});

describe("AFAIK_Question_Consolidated.xlsx", () => {
  // Fixture: QA-0001 "who is the PD of mimosa" (not found), QA-0002 "who's the
  // project director for mimosa" (unavailable), QA-0003 "hi", QA-0004 OMS (truncated).

  it("has the three agreed sheets, in order", async () => {
    const wb = await readWorkbook(await exportQuestionWorkbook(await consolidated()));
    expect(wb.names).toEqual(["RAW_Q&A", "CONSOLIDATED_QUESTIONS", "SUMMARY"]);
    expect(WORKBOOK_FILENAME).toBe("AFAIK_Question_Consolidated.xlsx");
  });

  it("RAW_Q&A keeps every record — conversational ones included — with original values unchanged", async () => {
    const data = await consolidated();
    const [raw] = buildQuestionSheets(data);
    expect(raw.columns.map((c) => c.header)).toEqual([
      "QA ID", "Timestamp (UTC)", "User Question", "Answer", "Status", "Question Type",
      "Question ID", "Channel", "Source File", "Source Row", "Session ID",
    ]);
    expect(raw.rows).toHaveLength(data.records.length);
    for (const [i, r] of data.records.entries()) {
      expect(raw.rows[i][2]).toBe(r.question);
      expect(raw.rows[i][3]).toBe(answerCell(r));
      expect(raw.rows[i][10]).toBe(r.sessionId);
    }
    expect(raw.rows.map((row) => [row[0], row[5], row[6]])).toEqual([
      ["QA-0001", "Information", "Q-001"], ["QA-0002", "Information", "Q-002"],
      ["QA-0003", "Conversational", ""], ["QA-0004", "Information", "Q-003"],
    ]);
  });

  it("labels answer parts only when there are several, keeping each part's text exact", () => {
    expect(answerCell({ answerParts: [] })).toBe("");
    expect(answerCell({ answerParts: [{ text: "only" }] })).toBe("only");
    expect(answerCell({ answerParts: [{ text: "a" }, { text: "b" }] })).toBe("[Part 1] a\n\n[Part 2] b");
  });

  it("CONSOLIDATED_QUESTIONS lists each clean question with every original", async () => {
    const [, cq] = buildQuestionSheets(await consolidated());
    expect(cq.columns.map((c) => c.header)).toEqual([
      "Question ID", "Clean Question", "Occurrence Count", "Original QA IDs", "Original Questions", "Answer Status", "Notes",
    ]);
    expect(cq.rows).toEqual([
      ["Q-001", "Who is the PD of mimosa?", 1, "QA-0001", "who is the PD of mimosa", "Not Answered", "Reply: agent said the information was not found."],
      ["Q-002", "Who's the project director for mimosa?", 1, "QA-0002", "who's the project director for mimosa", "Not Answered", "Reply: agent unavailable."],
      ["Q-003", "Links for the operations oms?", 1, "QA-0004", "links for the operations oms", "Cannot Determine", "Reply: reply cut off by the export."],
    ]);
  });

  it("SUMMARY counts what the other two sheets contain", async () => {
    const wb = await readWorkbook(await exportQuestionWorkbook(await consolidated()));
    expect(Object.fromEntries(wb.sheets.SUMMARY.rows.slice(1).map(([k, v]) => [k, v]))).toMatchObject({
      "Files Imported": 1, "Sessions": 2, "Total Q&A": 4, "Information Questions": 3, "Conversational Questions": 1,
      "Consolidated Questions": 3, "Repeated Questions": 0,
      "Answered": 0, "Partially Answered": 0, "Not Answered": 2, "Cannot Determine": 1,
    });
  });
});
