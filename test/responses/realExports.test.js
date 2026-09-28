import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readResponseFile, mergeImport, summarize, EMPTY_WORKSPACE, FILE_STATUS,
} from "../../src/lib/responses/importSessions.js";
import { extractQA, summarizeQA } from "../../src/lib/responses/qa.js";
import { SPEAKER } from "../../src/lib/responses/transcript.js";
import { buildIntentRequest } from "../../src/lib/responses/ai/intentPackage.js";

/* Real AFAIK session exports, gitignored — see README.md in this
 * folder. The invariants hold for any set of exports. The fixed counts
 * at the end apply only to the September 2026 set they were measured
 * on (validated 2026-09-28): add or remove a file and that block skips
 * rather than failing on a number that no longer describes the data. */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const names = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((n) => /\.(csv|xlsx)$/i.test(n)).sort()
  : [];

describe.skipIf(names.length === 0)("real AFAIK session exports (local only)", () => {
  const load = async () => {
    const parsed = await Promise.all(names.map((name) => {
      const buf = fs.readFileSync(path.join(DIR, name));
      return readResponseFile({ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    }));
    return { parsed, ...mergeImport(EMPTY_WORKSPACE, parsed, "2026-01-01T00:00:00.000Z") };
  };

  it("imports every file without rejection", async () => {
    const { workspace } = await load();
    const bad = workspace.files.filter((f) => f.status === FILE_STATUS.REJECTED).map((f) => `${f.filename}: ${f.message}`);
    expect(bad).toEqual([]);
  });

  it("accounts for every row: each is a session or an occurrence of one", async () => {
    const { parsed, workspace } = await load();
    const imported = new Set(workspace.files.filter((f) => f.status === FILE_STATUS.IMPORTED).map((f) => f.filename));
    const rows = parsed.filter((p) => imported.has(p.filename)).reduce((n, p) => n + p.rows.length, 0);
    const occurrences = workspace.sessions.reduce((n, s) => n + s.occurrences.length, 0);
    expect(occurrences).toBe(rows);
    const s = summarize(workspace);
    console.info(`[real exports] ${s.files} files, ${s.rows} rows, ${s.sessions} unique sessions, ${s.multiSourceSessions} in more than one file, ${s.conflicts} conflicting`);
  });

  it("keeps every transcript byte-for-byte as exported", async () => {
    const { workspace } = await load();
    for (const s of workspace.sessions) {
      const raw = s.occurrences[0].raw;
      const header = Object.keys(raw).find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === "chattranscript");
      expect(s.transcript, s.id).toBe(raw[header]);
    }
  });

  it("reads a timestamp for every session that has one", async () => {
    const { workspace } = await load();
    const unread = workspace.sessions.filter((s) => s.timestampRaw.trim() && !s.timestamp).map((s) => s.timestampRaw);
    expect(unread).toEqual([]);
  });
});

/* Filenames only — dates, no content. */
const SEPTEMBER_2026 = [
  "Sessions 9_7_26 - 9_8_26 UTC.csv", "Sessions 9_8_26 - 9_9_26 UTC.csv", "Sessions 9_9_26 - 9_10_26 UTC.csv",
  "Sessions 9_10_26 - 9_11_26 UTC.csv", "Sessions 9_11_26 - 9_12_26 UTC.csv", "Sessions 9_14_26 - 9_15_26 UTC.csv",
  "Sessions 9_15_26 - 9_16_26 UTC.csv", "Sessions 9_16_26 - 9_17_26 UTC.csv", "Sessions 9_21_26 - 9_22_26 UTC.csv",
  "Sessions 9_22_26 - 9_23_26 UTC.csv", "Sessions 9_23_26 - 9_24_26 UTC.csv", "Sessions 9_24_26 - 9_25_26 UTC.csv",
].sort();
const isSeptemberSet = names.length === SEPTEMBER_2026.length && names.every((n, i) => n === SEPTEMBER_2026[i]);

async function extracted() {
  const parsed = await Promise.all(names.map((name) => {
    const buf = fs.readFileSync(path.join(DIR, name));
    return readResponseFile({ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  }));
  const { workspace } = mergeImport(EMPTY_WORKSPACE, parsed, "2026-01-01T00:00:00.000Z");
  return { workspace, ...extractQA(workspace.sessions) };
}

describe.skipIf(names.length === 0)("real exports — transcript parsing invariants (local only)", () => {
  it("rebuilds every transcript byte-for-byte from its parsed entries", async () => {
    const { workspace, parsedSessions } = await extracted();
    parsedSessions.forEach((p, i) => expect(p.entries.map((e) => e.source).join(""), p.sessionRecordId).toBe(workspace.sessions[i].transcript));
  });

  it("turns every User message into exactly one record, with its exact text", async () => {
    const { records, parsedSessions } = await extracted();
    const users = parsedSessions.flatMap((p) => p.entries.filter((e) => e.speaker === SPEAKER.USER).map((e) => e.text));
    expect(records.map((r) => r.question)).toEqual(users);
  });

  it("finds no unknown speakers, unparsed text or Turns mismatches", async () => {
    const { parsedSessions } = await extracted();
    expect(parsedSessions.filter((p) => p.parseStatus !== "OK").map((p) => `${p.sessionRecordId}: ${p.parseFlags}`)).toEqual([]);
  });
});

describe.skipIf(!isSeptemberSet)("real exports — September 2026 regression counts (local only)", () => {
  it("matches the counts established by the pre-Phase-5 validation", async () => {
    const { workspace, ...qa } = await extracted();
    expect(workspace.sessions).toHaveLength(55);
    expect(summarizeQA(qa)).toEqual({
      records: 49,
      byStatus: { ANSWERED: 13, AGENT_UNAVAILABLE: 5, NO_RESPONSE: 1, REDACTED: 8, TRUNCATED: 22 },
      // Answer Type (added with Phase 7) — reviewed record by record on 2026-09-28.
      byAnswerType: { KNOWLEDGE: 20, NOT_FOUND: 8, CONVERSATIONAL: 6, SYSTEM_NOTICE: 1, NONE: 14 },
      informationRequests: 42,
      conversational: 7,
      potentialKnowledgeGaps: 8,
      sessionsWithQuestions: 29,
      multiQuestionSessions: 10,
      multiPartAnswers: 11,
      requiresReview: 9, // REDACTED 8 + NO_RESPONSE 1; truncation alone is not a review reason
      parseMismatches: 0,
      sessionsWithParseIssues: 0,
    });
  });

  it("sends the 42 information requests to intent consolidation and nothing else", async () => {
    const { records } = await extracted();
    const req = buildIntentRequest(records);
    expect(req.counts).toEqual({ records: 49, items: 42, excluded: 7, potentialKnowledgeGaps: 8 });
    // Data minimisation: no session IDs or source files unless asked for.
    expect(req.items.every((i) => !("sessionId" in i) && !("sourceFile" in i))).toBe(true);
    // Every sent question is its exact extracted text.
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(req.items.every((i) => i.question === byId.get(i.qaId).question)).toBe(true);
  });
});
