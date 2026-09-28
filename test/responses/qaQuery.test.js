import { describe, it, expect } from "vitest";
import { readResponseFile, mergeImport, EMPTY_WORKSPACE } from "../../src/lib/responses/importSessions.js";
import { extractQA, ANSWER_STATUS } from "../../src/lib/responses/qa.js";
import { filterQA, sortQA } from "../../src/lib/responses/qaQuery.js";
import { ROWS, toCsv, fileFrom, tx, TRUNCATED_ANSWER } from "./fixtures.js";

async function load() {
  const extra = [...ROWS[1]];
  extra[0] = "sess-004"; extra[1] = "2026-09-20 10:00:00"; extra[5] = "3";
  extra[6] = tx(["User", "links for the operations oms"], ["Agent", TRUNCATED_ANSWER], ["User", "still there?"]);
  const parsed = await Promise.all([
    readResponseFile(fileFrom("a.csv", toCsv([ROWS[0], ROWS[1], ROWS[2]]))),
    readResponseFile(fileFrom("b.csv", toCsv([extra]))),
  ]);
  return extractQA(mergeImport(EMPTY_WORKSPACE, parsed, "x").workspace.sessions).records;
}
const ids = (rs) => rs.map((r) => r.id);

describe("extracted Q&A query", () => {
  it("has the expected records to query", async () => {
    const r = await load();
    expect(r.map((x) => [x.id, x.answerStatus])).toEqual([
      ["QA-0001", "ANSWERED"], ["QA-0002", "ANSWERED"], ["QA-0003", "ANSWERED"], ["QA-0004", "ANSWERED"],
      ["QA-0005", "TRUNCATED"], ["QA-0006", "NO_RESPONSE"],
    ]);
  });

  it("searches questions, answer parts, QA IDs and session IDs", async () => {
    const r = await load();
    expect(ids(filterQA(r, { text: "GIVE ME THE LINKS" }))).toEqual(["QA-0002", "QA-0003"]);
    expect(ids(filterQA(r, { text: "configured knowledge source" }))).toEqual(["QA-0004", "QA-0005"]);
    expect(ids(filterQA(r, { text: "sess-004" }))).toEqual(["QA-0005", "QA-0006"]);
    expect(ids(filterQA(r, { text: "qa-0001" }))).toEqual(["QA-0001"]);
  });

  it("filters by answer status, review need and source file", async () => {
    const r = await load();
    expect(ids(filterQA(r, { answerStatus: ANSWER_STATUS.TRUNCATED }))).toEqual(["QA-0005"]);
    expect(ids(filterQA(r, { reviewOnly: true }))).toEqual(["QA-0005", "QA-0006"]);
    expect(ids(filterQA(r, { sourceFile: "b.csv" }))).toEqual(["QA-0005", "QA-0006"]);
    expect(ids(filterQA(r, { parseIssuesOnly: true }))).toEqual([]);
  });

  it("sorts by date then turn, keeping each session's questions in order", async () => {
    const r = await load();
    expect(ids(sortQA(r, "timestamp", "asc"))).toEqual(["QA-0005", "QA-0006", "QA-0001", "QA-0002", "QA-0003", "QA-0004"]);
    expect(ids(sortQA(r, "id", "desc"))[0]).toBe("QA-0006");
  });
});
