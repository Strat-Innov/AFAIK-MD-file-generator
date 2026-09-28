import { describe, it, expect } from "vitest";
import { readResponseFile, mergeImport, EMPTY_WORKSPACE } from "../../src/lib/responses/importSessions.js";
import { extractQA } from "../../src/lib/responses/qa.js";
import {
  buildInitialGroups, applyConsolidation, normalizeQuestion, cleanQuestionText, evaluateRecord, ANSWER_EVALUATION,
} from "../../src/lib/responses/consolidate.js";
import { ROWS, toCsv, fileFrom, tx, GREETING, UNAVAILABLE_NOTICE, TRUNCATED_ANSWER } from "./fixtures.js";

async function recordsFrom(...transcripts) {
  const rows = transcripts.map((t, i) => {
    const r = [...ROWS[0]];
    r[0] = `s-${i + 1}`; r[5] = String(t.split(" says: ").length - 1); r[6] = t;
    return r;
  });
  const parsed = [await readResponseFile(fileFrom("Sessions test UTC.csv", toCsv(rows)))];
  return extractQA(mergeImport(EMPTY_WORKSPACE, parsed, "x").workspace.sessions).records;
}

describe("question text", () => {
  it("normalises only case, spacing and punctuation", () => {
    expect(normalizeQuestion("  Give me the links for Operations OMS?? ")).toBe("give me the links for operations oms");
    expect(normalizeQuestion("How to file a permit?")).toBe(normalizeQuestion("how to file a permit"));
    expect(normalizeQuestion("1-BR price")).toBe("1 br price");
  });

  it("tidies the original wording without rewording it", () => {
    expect(cleanQuestionText("  hectares of   mimosa plus ")).toBe("Hectares of mimosa plus?");
    expect(cleanQuestionText("how to file a permit?")).toBe("How to file a permit?");
    expect(cleanQuestionText("Tell me about 1001 parkway.")).toBe("Tell me about 1001 parkway.");
  });
});

describe("answer result from the transcript", () => {
  const rec = (answerStatus, ...texts) => ({ answerStatus, answerParts: texts.map((text) => ({ text, kind: answerStatus === "TRUNCATED" ? "TRUNCATED" : "NORMAL" })) });

  it.each([
    [rec("ANSWERED", "Here are the OMS links."), "ANSWERED"],
    [rec("ANSWERED", "I'm sorry but I was unable to find any information about CAI."), "NOT_ANSWERED"],
    [rec("ANSWERED", "I'm sorry but **this information is not available in the configured knowledge source.**"), "NOT_ANSWERED"],
    [{ answerStatus: "AGENT_UNAVAILABLE", answerParts: [] }, "NOT_ANSWERED"],
    [{ answerStatus: "NO_RESPONSE", answerParts: [] }, "NOT_ANSWERED"],
    [{ answerStatus: "REDACTED", answerParts: [{ text: "[REDACTED]", kind: "REDACTED" }] }, "CANNOT_DETERMINE"],
    [rec("TRUNCATED", TRUNCATED_ANSWER), "CANNOT_DETERMINE"],
    [rec("TRUNCATED", "I was unable to find any information about the 1-BR price. " + "x".repeat(480) + "..."), "NOT_ANSWERED"],
  ])("%#: evaluates to %s", (record, expected) => {
    expect(evaluateRecord(record).evaluation).toBe(expected);
  });

  it("never reads truncation as 'not answered'", () => {
    expect(evaluateRecord(rec("TRUNCATED", TRUNCATED_ANSWER)).evaluation).not.toBe(ANSWER_EVALUATION.NOT_ANSWERED);
  });
});

describe("initial groups (exact match)", () => {
  it("merges identical questions, ignoring case, spacing and punctuation — across sessions", async () => {
    const records = await recordsFrom(
      tx(["User", "hectares of mimosa plus"], ["Agent", UNAVAILABLE_NOTICE]),
      tx(["User", "Hectares of Mimosa Plus?"], ["Agent", "Mimosa Plus spans 201 hectares."]),
      tx(["User", "hectares  of mimosa plus"], ["Agent", UNAVAILABLE_NOTICE]),
    );
    const [q] = buildInitialGroups(records);
    expect(q).toEqual({
      groupId: "IG-001",
      cleanQuestion: "Hectares of mimosa plus?",
      qaIds: ["QA-0001", "QA-0002", "QA-0003"],
      answerEvaluation: "ANSWERED",
      notes: "Asked 3 times: 2 agent unavailable, 1 answered.",
    });
  });

  it("keeps reworded questions and different questions on the same subject separate", async () => {
    const records = await recordsFrom(tx(
      ["User", "who is the PD of mimosa"], ["Agent", "a"],
      ["User", "who's the project director for mimosa"], ["Agent", "a"],
      ["User", "what is mimosa plus"], ["Agent", "a"],
    ));
    expect(buildInitialGroups(records).map((q) => q.qaIds)).toEqual([["QA-0001"], ["QA-0002"], ["QA-0003"]]);
  });

  it("leaves conversational questions out, and covers every information question exactly once", async () => {
    const records = await recordsFrom(
      tx(["Agent", GREETING], ["User", "hi"], ["Agent", "Bot said:Hi!"], ["User", "links for the operations oms"], ["Agent", TRUNCATED_ANSWER]),
      tx(["User", "Links for the Operations OMS"], ["Agent", "[REDACTED]"], ["User", "hmp"], ["Agent", "I'm back!"]),
    );
    const qs = buildInitialGroups(records);
    const ids = qs.flatMap((q) => q.qaIds);
    const info = records.filter((r) => r.includeInConsolidation).map((r) => r.id);
    expect(ids.sort()).toEqual(info.sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ answerEvaluation: "CANNOT_DETERMINE", notes: "Asked 2 times: 1 reply cut off by the export, 1 reply redacted in the export." });
  });

  it("numbers questions in order of first appearance and is deterministic", async () => {
    const records = await recordsFrom(tx(["User", "b question"], ["Agent", "a"], ["User", "a question"], ["Agent", "a"], ["User", "B question"], ["Agent", "a"]));
    const qs = buildInitialGroups(records);
    expect(qs.map((q) => [q.groupId, q.cleanQuestion, q.qaIds])).toEqual([
      ["IG-001", "B question?", ["QA-0001", "QA-0003"]],
      ["IG-002", "A question?", ["QA-0002"]],
    ]);
    expect(JSON.stringify(buildInitialGroups(records))).toBe(JSON.stringify(qs));
  });

  it("never changes the original questions", async () => {
    const records = await recordsFrom(tx(["User", "  hectares of mimosa plus "], ["Agent", "a"]));
    const before = JSON.stringify(records);
    buildInitialGroups(records);
    expect(JSON.stringify(records)).toBe(before);
    expect(records[0].question).toBe("  hectares of mimosa plus ");
  });

  it("explains a single non-answered question in the notes, and leaves answered ones blank", async () => {
    const records = await recordsFrom(tx(["User", "q1"], ["Agent", UNAVAILABLE_NOTICE], ["User", "q2"], ["Agent", "Here it is."]));
    expect(buildInitialGroups(records).map((q) => [q.answerEvaluation, q.notes])).toEqual([
      ["NOT_ANSWERED", "Reply: agent unavailable."],
      ["ANSWERED", ""],
    ]);
  });
});

describe("AI-assisted consolidation of initial groups", () => {
  it("merges the groups the AI names, expanding to every QA ID, with the AI's clean question", async () => {
    const records = await recordsFrom(tx(
      ["User", "At South Station Transport Terminal how much does a 1-BR Unit cost?"], ["Agent", TRUNCATED_ANSWER],
      ["User", "at south station transport terminal how much does a 1-br unit cost"], ["Agent", UNAVAILABLE_NOTICE],
      ["User", "South Station 1BR price?"], ["Agent", "I was unable to find any information about the 1-BR price."],
      ["User", "What projects are under Filigree?"], ["Agent", "Filigree projects: A, B."],
    ));
    const groups = buildInitialGroups(records);
    expect(groups.map((g) => g.qaIds)).toEqual([["QA-0001", "QA-0002"], ["QA-0003"], ["QA-0004"]]);
    const cq = applyConsolidation(records, groups, [
      { cleanQuestion: "What is the price of a 1-BR unit at South Station Transport Terminal?", groupIds: ["IG-001", "IG-002"] },
      { cleanQuestion: "What projects are under the Filigree brand?", groupIds: ["IG-003"] },
    ]);
    expect(cq).toEqual([
      {
        questionId: "CQ-001", cleanQuestion: "What is the price of a 1-BR unit at South Station Transport Terminal?",
        qaIds: ["QA-0001", "QA-0002", "QA-0003"], groupIds: ["IG-001", "IG-002"],
        answerEvaluation: "CANNOT_DETERMINE",
        notes: "Asked 3 times: 1 reply cut off by the export, 1 agent unavailable, 1 agent said the information was not found.",
      },
      { questionId: "CQ-002", cleanQuestion: "What projects are under the Filigree brand?", qaIds: ["QA-0004"], groupIds: ["IG-003"], answerEvaluation: "ANSWERED", notes: "" },
    ]);
  });
});
