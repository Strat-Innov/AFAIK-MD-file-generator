import { describe, it, expect } from "vitest";
import {
  readResponseFile, mergeImport, summarize, mapHeaders, parseTimestamp, parseResolved,
  EMPTY_WORKSPACE, FILE_STATUS, SESSION_FLAGS, LEGACY_XLS_MESSAGE,
} from "../../src/lib/responses/importSessions.js";
import { HEADERS, ROWS, toCsv, fileFrom, buildWorkbook, MULTI_QUESTION_TRANSCRIPT } from "./fixtures.js";

const AT = "2026-09-28T00:00:00.000Z";
const importAll = async (files, ws = EMPTY_WORKSPACE) =>
  mergeImport(ws, await Promise.all(files.map(readResponseFile)), AT);

describe("header mapping", () => {
  it("maps every column of the real export shape", () => {
    const { mapping, unmapped, missing } = mapHeaders(HEADERS);
    expect(Object.keys(mapping)).toEqual(HEADERS);
    expect(unmapped).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("tolerates spacing, casing and punctuation in header names", () => {
    const { mapping } = mapHeaders(["Session Id", "Start Date Time (UTC)", "chat_transcript"]);
    expect(Object.values(mapping)).toEqual(["sessionId", "startDateTime", "transcript"]);
  });

  it("reports unknown columns rather than dropping them", () => {
    const { unmapped, missing } = mapHeaders(["SessionId", "ChatTranscript", "AgentVersion"]);
    expect(unmapped).toEqual(["AgentVersion"]);
    expect(missing).toContain("Channel");
  });
});

describe("value readings", () => {
  it.each([
    ["2026-09-23 03:14:05", "2026-09-23T03:14:05.000Z"],
    ["2026-09-23T03:14:05Z", "2026-09-23T03:14:05.000Z"],
    ["2026-09-23T11:14:05+08:00", "2026-09-23T03:14:05.000Z"],
    ["9/23/2026 4:05:00 PM", "2026-09-23T16:05:00.000Z"],
    ["9/23/2026 12:05 AM", "2026-09-23T00:05:00.000Z"],
    ["9/23/2026", "2026-09-23T00:00:00.000Z"],
    ["46288.5", "2026-09-23T12:00:00.000Z"], // Excel serial
  ])("reads %s as UTC", (raw, iso) => expect(parseTimestamp(raw)).toBe(iso));

  it.each(["", "yesterday", "2/30/2026", "13/45/2026 1:00", "42"])("refuses to guess %j", (raw) => {
    expect(parseTimestamp(raw)).toBeNull();
  });

  it("reads resolved flags without guessing", () => {
    expect([parseResolved("True"), parseResolved("FALSE"), parseResolved("1"), parseResolved(""), parseResolved("maybe")])
      .toEqual([true, false, true, null, null]);
  });
});

describe("importing session exports", () => {
  it("imports a CSV into raw sessions with every field intact", async () => {
    const { workspace, report } = await importAll([fileFrom("Sessions 9_23_26 - 9_24_26 UTC.csv", toCsv(ROWS))]);
    expect(report).toMatchObject({ imported: 1, rejected: 0, sessionsAdded: 3 });
    const [s] = workspace.sessions;
    expect(s).toMatchObject({
      id: "S-0001", sessionId: "sess-001", timestamp: "2026-09-23T03:14:05.000Z", outcome: "Resolved",
      resolved: true, turns: 4, channel: "msteams", csat: "5", initialUserMessage: "give me oms for operations",
    });
    expect(s.transcript).toBe(MULTI_QUESTION_TRANSCRIPT);
    expect(s.occurrences).toEqual([{
      fileId: "F-001", filename: "Sessions 9_23_26 - 9_24_26 UTC.csv", rowNumber: 2,
      raw: Object.fromEntries(HEADERS.map((h, i) => [h, ROWS[0][i]])),
    }]);
  });

  it("reads the same records from XLSX as from CSV", async () => {
    const csv = (await importAll([fileFrom("a.csv", toCsv(ROWS))])).workspace.sessions;
    const wb = new Uint8Array(await buildWorkbook([HEADERS, ...ROWS]));
    const xlsx = (await importAll([fileFrom("a.xlsx", wb)])).workspace.sessions;
    const strip = (s) => ({ ...s, occurrences: undefined, extra: undefined });
    expect(xlsx.map(strip)).toEqual(csv.map(strip));
  });

  it("combines several files and keeps each session's source", async () => {
    const { workspace } = await importAll([
      fileFrom("Sessions 9_22_26.csv", toCsv([ROWS[2]])),
      fileFrom("Sessions 9_23_26.csv", toCsv([ROWS[0], ROWS[1]])),
    ]);
    expect(workspace.sessions.map((s) => [s.sessionId, s.occurrences[0].filename])).toEqual([
      ["sess-003", "Sessions 9_22_26.csv"],
      ["sess-001", "Sessions 9_23_26.csv"],
      ["sess-002", "Sessions 9_23_26.csv"],
    ]);
    expect(summarize(workspace)).toMatchObject({ files: 2, sessions: 3, rows: 3 });
  });

  it("merges a session repeated across overlapping exports into one, keeping both occurrences", async () => {
    const { workspace, report } = await importAll([
      fileFrom("day1.csv", toCsv([ROWS[0], ROWS[1]])),
      fileFrom("day2.csv", toCsv([ROWS[1], ROWS[2]])),
    ]);
    expect(report).toMatchObject({ sessionsAdded: 3, sessionsMerged: 1, conflicts: 0 });
    const s = workspace.sessions.find((x) => x.sessionId === "sess-002");
    expect(s.occurrences.map((o) => o.filename)).toEqual(["day1.csv", "day2.csv"]);
    expect(summarize(workspace).multiSourceSessions).toBe(1);
  });

  it("keeps both and flags them when one SessionId arrives with different content", async () => {
    const changed = [...ROWS[1]];
    changed[6] = changed[6] + ";User says: a different follow-up";
    const { workspace, report } = await importAll([
      fileFrom("a.csv", toCsv([ROWS[1]])),
      fileFrom("b.csv", toCsv([changed])),
    ]);
    expect(report.conflicts).toBe(1);
    const twins = workspace.sessions.filter((s) => s.sessionId === "sess-002");
    expect(twins).toHaveLength(2);
    expect(twins.every((s) => s.flags.includes(SESSION_FLAGS.DUPLICATE_ID_CONFLICT))).toBe(true);
    expect(twins.map((s) => s.transcript)).toEqual([ROWS[1][6], changed[6]]);
  });

  it("skips a file dropped twice, by content rather than name", async () => {
    const first = await importAll([fileFrom("a.csv", toCsv(ROWS))]);
    const { workspace, report } = await importAll([fileFrom("renamed copy.csv", toCsv(ROWS))], first.workspace);
    expect(report).toMatchObject({ duplicateFiles: 1, sessionsAdded: 0 });
    expect(workspace.sessions).toHaveLength(3);
    expect(workspace.files[1]).toMatchObject({ status: FILE_STATUS.DUPLICATE_FILE, filename: "renamed copy.csv" });
  });

  it("rejects legacy .xls with the agreed message and still imports the rest", async () => {
    const { workspace, report } = await importAll([
      fileFrom("old.xls", "binary"),
      fileFrom("ok.csv", toCsv(ROWS)),
    ]);
    expect(report).toMatchObject({ rejected: 1, imported: 1, sessionsAdded: 3 });
    expect(workspace.files[0]).toMatchObject({ status: FILE_STATUS.REJECTED, message: LEGACY_XLS_MESSAGE });
  });

  it("rejects unsupported types and files that are not session exports", async () => {
    const { workspace } = await importAll([
      fileFrom("page.aspx", "<html/>"),
      fileFrom("other.csv", "Name,Email\r\nA,b@example.test\r\n"),
      fileFrom("empty.csv", ""),
    ]);
    expect(workspace.files.map((f) => f.status)).toEqual([FILE_STATUS.REJECTED, FILE_STATUS.REJECTED, FILE_STATUS.REJECTED]);
    expect(workspace.files[1].message).toMatch(/neither a SessionId nor a ChatTranscript/);
    expect(workspace.sessions).toEqual([]);
  });

  it("preserves unrecognised columns on the session and in the raw row", async () => {
    const csv = toCsv([[...ROWS[0], "v2.1"]], [...HEADERS, "AgentVersion"]);
    const { workspace } = await importAll([fileFrom("a.csv", csv)]);
    expect(workspace.sessions[0].extra).toEqual({ AgentVersion: "v2.1" });
    expect(workspace.sessions[0].occurrences[0].raw.AgentVersion).toBe("v2.1");
    expect(workspace.files[0].unmappedHeaders).toEqual(["AgentVersion"]);
  });

  it("keeps the raw text beside every typed reading", async () => {
    const row = [...ROWS[0]];
    row[1] = "sometime last week";
    const { workspace } = await importAll([fileFrom("a.csv", toCsv([row]))]);
    const s = workspace.sessions[0];
    expect(s.timestamp).toBeNull();
    expect(s.timestampRaw).toBe("sometime last week");
    expect(s.flags).toContain(SESSION_FLAGS.UNPARSED_TIMESTAMP);
  });

  it("flags a row with no SessionId instead of dropping it", async () => {
    const row = [...ROWS[1]];
    row[0] = "";
    const { workspace } = await importAll([fileFrom("a.csv", toCsv([row]))]);
    expect(workspace.sessions[0].flags).toContain(SESSION_FLAGS.MISSING_SESSION_ID);
  });

  it("never mutates the raw layer: records are frozen and earlier workspaces are unchanged", async () => {
    const first = await importAll([fileFrom("a.csv", toCsv([ROWS[0], ROWS[1]]))]);
    const snapshot = JSON.stringify(first.workspace);
    await importAll([fileFrom("b.csv", toCsv([ROWS[1], ROWS[2]]))], first.workspace);
    expect(JSON.stringify(first.workspace)).toBe(snapshot);

    const s = first.workspace.sessions[0];
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.occurrences[0].raw)).toBe(true);
    expect(() => { s.transcript = "rewritten"; }).toThrow(TypeError);
    expect(() => { first.workspace.sessions.push({}); }).toThrow(TypeError);
  });
});
