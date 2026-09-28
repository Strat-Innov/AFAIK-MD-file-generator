import { describe, it, expect } from "vitest";
import { readResponseFile, mergeImport, EMPTY_WORKSPACE } from "../../src/lib/responses/importSessions.js";
import {
  extractQA, summarizeQA, classifyPart, answerStatusOf, ANSWER_STATUS, PART_KIND, STATUS_METADATA,
  QUESTION_KIND,
} from "../../src/lib/responses/qa.js";
import { PARSE_STATUS } from "../../src/lib/responses/transcript.js";
import { ROWS, toCsv, fileFrom, tx, GREETING, UNAVAILABLE_NOTICE, TRUNCATED_ANSWER } from "./fixtures.js";

/* One synthetic session per row: [id, transcript, turns, initialUserMessage, outcome] */
async function sessionsFrom(specs) {
  const rows = specs.map(([id, transcript, turns, ium = "", outcome = "Resolved"]) => {
    const r = [...ROWS[0]];
    r[0] = id; r[2] = outcome; r[5] = String(turns); r[6] = transcript; r[7] = ium;
    return r;
  });
  const parsed = [await readResponseFile(fileFrom("Sessions test UTC.csv", toCsv(rows)))];
  return mergeImport(EMPTY_WORKSPACE, parsed, "2026-09-28T00:00:00.000Z").workspace.sessions;
}
const one = async (transcript, turns, ium, outcome) => extractQA(await sessionsFrom([["s-1", transcript, turns, ium, outcome]]));

describe("part and answer classification", () => {
  it("recognises truncation only when an answer is both at the export cap and ends with '...'", () => {
    expect(classifyPart(TRUNCATED_ANSWER)).toBe(PART_KIND.TRUNCATED);
    expect(classifyPart("A short answer that trails off...")).toBe(PART_KIND.NORMAL);
    expect(classifyPart("x".repeat(520))).toBe(PART_KIND.NORMAL);
  });

  it("recognises the literal redaction, the usage-limit notice, and nothing looser", () => {
    expect(classifyPart("[REDACTED]")).toBe(PART_KIND.REDACTED);
    expect(classifyPart("Some of this was [REDACTED] earlier")).toBe(PART_KIND.NORMAL);
    expect(classifyPart(UNAVAILABLE_NOTICE)).toBe(PART_KIND.UNAVAILABLE);
    expect(classifyPart("That office is currently unavailable for walk-ins.")).toBe(PART_KIND.NORMAL);
  });

  it("combines parts most-restrictive first", () => {
    const p = (...kinds) => kinds.map((kind) => ({ kind }));
    expect(answerStatusOf([])).toBe(ANSWER_STATUS.NO_RESPONSE);
    expect(answerStatusOf(p("NORMAL", "REDACTED"))).toBe(ANSWER_STATUS.REDACTED);
    expect(answerStatusOf(p("TRUNCATED", "NORMAL"))).toBe(ANSWER_STATUS.TRUNCATED);
    expect(answerStatusOf(p("UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"))).toBe(ANSWER_STATUS.AGENT_UNAVAILABLE);
    expect(answerStatusOf(p("NORMAL", "UNAVAILABLE"))).toBe(ANSWER_STATUS.ANSWERED);
  });

  it("describes transcript completeness per status — never answer correctness", () => {
    expect(STATUS_METADATA).toEqual({
      ANSWERED: { answerCompleteness: "COMPLETE", requiresReview: false },
      TRUNCATED: { answerCompleteness: "TRUNCATED", requiresReview: false },
      REDACTED: { answerCompleteness: "NONE", requiresReview: true },
      AGENT_UNAVAILABLE: { answerCompleteness: "NONE", requiresReview: false },
      NO_RESPONSE: { answerCompleteness: "NONE", requiresReview: true },
    });
  });
});

describe("Q&A extraction", () => {
  it("1–3. agent preamble is not a question; User → Agent and Agent → User → Agent give one record each", async () => {
    const { records, parsedSessions } = await extractQA(await sessionsFrom([
      ["s-1", tx(["User", "q1"], ["Agent", "a1"]), 2],
      ["s-2", tx(["Agent", GREETING], ["User", "q2"], ["Agent", "a2"]), 3],
    ]));
    expect(records.map((r) => [r.id, r.sessionId, r.question, r.answerParts.map((p) => p.text), r.turnNumber]))
      .toEqual([["QA-0001", "s-1", "q1", ["a1"], 1], ["QA-0002", "s-2", "q2", ["a2"], 2]]);
    expect(parsedSessions[1].preamble).toEqual([{ turnNumber: 1, text: GREETING, kind: PART_KIND.NORMAL }]);
  });

  it("4 & 14. one session with several questions gives one record per question, same session", async () => {
    const { records } = await one(tx(
      ["Agent", GREETING], ["User", "give me oms for operations"], ["Agent", "a1"],
      ["User", "give me the links"], ["Agent", "a2"], ["User", "give me the links for operations OMS"], ["Agent", "a3"],
    ), 7);
    expect(records.map((r) => [r.questionNumber, r.turnNumber, r.question, r.answerParts[0].text])).toEqual([
      [1, 2, "give me oms for operations", "a1"],
      [2, 4, "give me the links", "a2"],
      [3, 6, "give me the links for operations OMS", "a3"],
    ]);
    expect(new Set(records.map((r) => r.sessionRecordId)).size).toBe(1);
  });

  it("5. keeps several agent messages as ordered parts, not joined", async () => {
    const { records } = await one(tx(["User", "hi"], ["Agent", "Hello!"], ["Agent", "How can I help?"]), 3);
    expect(records[0].answerParts).toEqual([
      { turnNumber: 2, text: "Hello!", kind: PART_KIND.NORMAL },
      { turnNumber: 3, text: "How can I help?", kind: PART_KIND.NORMAL },
    ]);
  });

  it("6. every reply the usage-limit notice → AGENT_UNAVAILABLE, whatever the SessionOutcome", async () => {
    for (const outcome of ["Unengaged", "Resolved", "Escalated", "Abandoned"]) {
      const { records } = await one(tx(["User", "mimosa plus"], ["Agent", UNAVAILABLE_NOTICE], ["Agent", UNAVAILABLE_NOTICE]), 3, "", outcome);
      expect(records[0]).toMatchObject({ answerStatus: ANSWER_STATUS.AGENT_UNAVAILABLE, sessionOutcome: outcome, requiresReview: false });
    }
  });

  it("7. a user message followed by another user message → NO_RESPONSE", async () => {
    const { records } = await one(tx(["Agent", GREETING], ["User", "first"], ["User", "second"], ["Agent", "reply"]), 4);
    expect(records.map((r) => [r.question, r.answerStatus])).toEqual([
      ["first", ANSWER_STATUS.NO_RESPONSE],
      ["second", ANSWER_STATUS.ANSWERED],
    ]);
    expect(records[0]).toMatchObject({ answerParts: [], answerCompleteness: "NONE", requiresReview: true });
  });

  it("7b. a user message at the end of the transcript → NO_RESPONSE", async () => {
    const { records } = await one(tx(["User", "anyone?"]), 1);
    expect(records[0].answerStatus).toBe(ANSWER_STATUS.NO_RESPONSE);
  });

  it("8. [REDACTED] → REDACTED, kept as the exact part", async () => {
    const { records } = await one(tx(["User", "who leads operations"], ["Agent", "[REDACTED]"]), 2);
    expect(records[0]).toMatchObject({ answerStatus: ANSWER_STATUS.REDACTED, answerCompleteness: "NONE", requiresReview: true });
    expect(records[0].answerParts[0].text).toBe("[REDACTED]");
  });

  it("9. a truncated answer is kept whole and flagged TRUNCATED — an export limit, not a verdict on the answer", async () => {
    const { records } = await one(tx(["User", "links for the operations oms"], ["Agent", TRUNCATED_ANSWER]), 2);
    expect(records[0]).toMatchObject({
      answerStatus: ANSWER_STATUS.TRUNCATED,
      answerCompleteness: "TRUNCATED",
      requiresReview: false,                // truncation alone is no reason for review
      includeInConsolidation: true,         // the question is fully valid
    });
    expect(records[0].answerParts[0].text).toBe(TRUNCATED_ANSWER);
  });

  it("10. a Turns mismatch is carried onto every record of the session", async () => {
    const { records } = await one(tx(["User", "q1"], ["Agent", "a1"], ["User", "q2"], ["Agent", "a2"]), 6);
    expect(records.map((r) => r.parseStatus)).toEqual([PARSE_STATUS.PARSE_MISMATCH, PARSE_STATUS.PARSE_MISMATCH]);
  });

  it("11. unknown speaker content inside an answer is kept beside it, not merged into it", async () => {
    const { records } = await one(tx(["User", "q"], ["System", "handoff"], ["Agent", "a"]), 3);
    expect(records[0].answerParts.map((p) => p.text)).toEqual(["a"]);
    expect(records[0].otherContent).toEqual([{ turnNumber: 2, speaker: "UNKNOWN", marker: "System says", text: "handoff" }]);
    expect(records[0].parseStatus).toBe(PARSE_STATUS.UNKNOWN_SPEAKER);
  });

  it('12. "Bot said:" inside an Agent message stays part of the answer text', async () => {
    const { records } = await one(tx(["User", "hi"], ["Agent", "Bot said:Hi! I'm your virtual assistant."]), 2);
    expect(records[0].answerParts[0].text).toBe("Bot said:Hi! I'm your virtual assistant.");
    expect(records[0].answerStatus).toBe(ANSWER_STATUS.ANSWERED);
  });

  it("13. an empty InitialUserMessage doesn't matter — the question comes from the transcript", async () => {
    const { records } = await one(tx(["Agent", GREETING], ["User", "cash advance process"], ["Agent", "a"]), 3, "");
    expect(records[0]).toMatchObject({ question: "cash advance process", initialUserMessage: "" });
  });

  it("13b. InitialUserMessage is reference only, even when it names a later question", async () => {
    const { records } = await one(tx(["User", "first"], ["User", "second"], ["Agent", "a"]), 3, "second");
    expect(records.map((r) => r.question)).toEqual(["first", "second"]);
    expect(records.every((r) => r.initialUserMessage === "second")).toBe(true);
  });

  it("keeps question text exactly, surrounding spaces included", async () => {
    const { records } = await one(tx(["User", " How many square meter is it? "], ["Agent", "a"]), 2);
    expect(records[0].question).toBe(" How many square meter is it? ");
  });

  it("keeps every record traceable to its session, file and row", async () => {
    const { records } = await one(tx(["User", "q"], ["Agent", "a"]), 2);
    expect(records[0]).toMatchObject({
      sessionRecordId: "S-0001", sessionId: "s-1", sourceFiles: ["Sessions test UTC.csv"],
      sourceRows: [{ fileId: "F-001", filename: "Sessions test UTC.csv", rowNumber: 2 }],
      timestamp: "2026-09-23T03:14:05.000Z", channel: "msteams",
    });
  });

  it("does not touch the raw sessions, and gives the same result every time", async () => {
    const sessions = await sessionsFrom([["s-1", ROWS[0][6], 7], ["s-2", ROWS[1][6], 2]]);
    const before = JSON.stringify(sessions);
    const a = extractQA(sessions);
    const b = extractQA(sessions);
    expect(JSON.stringify(sessions)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a.records[0])).toBe(true);
  });

  it("summarises statuses and review load", async () => {
    const out = extractQA(await sessionsFrom([
      ["s-1", tx(["User", "q1"], ["Agent", "a"], ["User", "q2"], ["Agent", TRUNCATED_ANSWER]), 4],
      ["s-2", tx(["Agent", GREETING], ["Agent", UNAVAILABLE_NOTICE]), 2],
      ["s-3", tx(["User", "q3"], ["Agent", "[REDACTED]"]), 5],
    ]));
    expect(summarizeQA(out)).toEqual({
      records: 3,
      byStatus: { ANSWERED: 1, AGENT_UNAVAILABLE: 0, NO_RESPONSE: 0, REDACTED: 1, TRUNCATED: 1 },
      informationRequests: 3,
      conversational: 0,
      sessionsWithQuestions: 2,
      multiQuestionSessions: 1,
      multiPartAnswers: 0,
      requiresReview: 1,
      parseMismatches: 1,
      sessionsWithParseIssues: 1,
    });
  });
});

describe("information questions vs conversation", () => {
  const kindOf = async (question, ...agent) => (await one(tx(["User", question], ...agent.map((a) => ["Agent", a])), 1 + agent.length)).records[0];

  it("a real question goes to consolidation, whatever the answer status", async () => {
    for (const agent of [["Here are the OMS links."], [TRUNCATED_ANSWER], ["[REDACTED]"], [UNAVAILABLE_NOTICE], []]) {
      const r = await kindOf("links for the operations oms", ...agent);
      expect(r, agent[0] ?? "no reply").toMatchObject({ questionKind: QUESTION_KIND.INFORMATION_REQUEST, includeInConsolidation: true });
    }
  });

  it("greetings and filler stay in the dataset but are kept out of consolidation", async () => {
    for (const q of ["hi", "Hello", "hey!", "hmp", "are you available to chat?"]) {
      const r = await kindOf(q, "Some reply.");
      expect(r, q).toMatchObject({ questionKind: QUESTION_KIND.CONVERSATIONAL, includeInConsolidation: false, question: q });
    }
  });

  it('a question answered with the agent\'s "Bot said:" greeting is conversational', async () => {
    expect(await kindOf("yo there", "Bot said:Hi! I'm your virtual assistant.")).toMatchObject({ questionKind: QUESTION_KIND.CONVERSATIONAL });
  });

  it('only a whole-message greeting counts — "hi, who is the PD of mimosa" is a real question', async () => {
    expect(await kindOf("hi, who is the PD of mimosa", "a")).toMatchObject({ questionKind: QUESTION_KIND.INFORMATION_REQUEST });
  });

  it("never changes the question, answer text or status", async () => {
    const r = await kindOf(" hi ", "Bot said:Hi!");
    expect(r).toMatchObject({ question: " hi ", answerStatus: ANSWER_STATUS.ANSWERED, answerCompleteness: "COMPLETE" });
    expect(r.answerParts[0].text).toBe("Bot said:Hi!");
    expect(r).not.toHaveProperty("answerType");
    expect(r).not.toHaveProperty("potentialKnowledgeGap");
  });
});
