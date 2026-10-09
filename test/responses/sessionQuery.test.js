import { describe, it, expect } from "vitest";
import { readResponseFile, mergeImport, EMPTY_WORKSPACE } from "../../src/lib/responses/importSessions.js";
import { filterSessions, sortSessions, facetValues, RESOLVED_FILTER } from "../../src/lib/responses/sessionQuery.js";
import { ROWS, toCsv, fileFrom } from "./fixtures.js";

const load = async () => {
  const extra = [...ROWS[1]];
  extra[0] = "sess-004"; extra[1] = "2026-09-25 10:00:00"; extra[11] = ""; extra[4] = "";
  const parsed = await Promise.all([
    readResponseFile(fileFrom("a.csv", toCsv([ROWS[0], ROWS[1]]))),
    readResponseFile(fileFrom("b.csv", toCsv([ROWS[2], extra]))),
  ]);
  return mergeImport(EMPTY_WORKSPACE, parsed, "2026-09-28T00:00:00.000Z").workspace.sessions;
};
const ids = (list) => list.map((s) => s.sessionId);

describe("raw session query", () => {
  it("searches transcripts, questions and session IDs case-insensitively", async () => {
    const s = await load();
    expect(ids(filterSessions(s, { text: "OPERATIONS OMS" }))).toEqual(["sess-001"]);
    expect(ids(filterSessions(s, { text: "usage limit" }))).toEqual(["sess-003"]);
    expect(ids(filterSessions(s, { text: "sess-002" }))).toEqual(["sess-002"]);
  });

  it("filters by channel, outcome, source file and resolution", async () => {
    const s = await load();
    expect(ids(filterSessions(s, { channel: "webchat" }))).toEqual(["sess-003"]);
    expect(ids(filterSessions(s, { outcome: "Abandoned" }))).toEqual(["sess-002", "sess-004"]);
    expect(ids(filterSessions(s, { sourceFile: "b.csv" }))).toEqual(["sess-003", "sess-004"]);
    expect(ids(filterSessions(s, { resolved: RESOLVED_FILTER.RESOLVED }))).toEqual(["sess-001"]);
    expect(ids(filterSessions(s, { resolved: RESOLVED_FILTER.UNRESOLVED }))).toEqual(["sess-002", "sess-003"]);
    expect(ids(filterSessions(s, { resolved: RESOLVED_FILTER.UNKNOWN }))).toEqual(["sess-004"]);
  });

  it("filters by an inclusive UTC date range", async () => {
    const s = await load();
    expect(ids(filterSessions(s, { dateFrom: "2026-09-23", dateTo: "2026-09-23" }))).toEqual(["sess-001", "sess-002"]);
    expect(ids(filterSessions(s, { dateFrom: "2026-09-24" }))).toEqual(["sess-004"]);
  });

  it("sorts by date either way, and puts blank values last in both directions", async () => {
    const s = await load();
    expect(ids(sortSessions(s, "timestamp", "desc"))).toEqual(["sess-004", "sess-002", "sess-001", "sess-003"]);
    expect(ids(sortSessions(s, "timestamp", "asc"))).toEqual(["sess-003", "sess-001", "sess-002", "sess-004"]);
    expect(ids(sortSessions(s, "csat", "asc")).at(-1)).not.toBe("sess-001");
    expect(ids(sortSessions(s, "csat", "desc"))[0]).toBe("sess-001");
  });

  it("offers facet values for the filter menus", async () => {
    const s = await load();
    expect(facetValues(s, "channel")).toEqual(["msteams", "webchat"]);
    expect(facetValues(s, "sourceFile")).toEqual(["a.csv", "b.csv"]);
  });

  it("does not reorder or alter the input", async () => {
    const s = await load();
    const before = ids(s);
    sortSessions(s, "channel", "asc");
    filterSessions(s, { text: "oms" });
    expect(ids(s)).toEqual(before);
  });
});
