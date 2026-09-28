import { describe, it, expect, beforeAll } from "vitest";
import { buildQuestionRequest, renderQuestionPrompt } from "../../src/lib/responses/ai/questionPackage.js";
import { validateQuestionReply } from "../../src/lib/responses/ai/questionResult.js";
import { consolidationRecords } from "./fixtures.js";

let request;
beforeAll(async () => { request = buildQuestionRequest(await consolidationRecords()); });

// QA-0001 (not found) and QA-0002 (unavailable) are rewordings; QA-0004 stands alone.
const pd = (over = {}) => ({
  questionId: "CQ-001",
  cleanQuestion: "Who is the project director of Mimosa?",
  qaIds: ["QA-0001", "QA-0002"],
  answerEvaluation: "NOT_ANSWERED",
  notes: "One reply said not found; the other hit the usage limit.",
  ...over,
});
const oms = (over = {}) => ({
  questionId: "CQ-002", cleanQuestion: "Where are the links to the Operations OMS?", qaIds: ["QA-0004"], answerEvaluation: "ANSWERED", ...over,
});
const reply = (questions, over = {}) => JSON.stringify({ packageId: request.packageId, questions, ...over });

describe("validating Claude's consolidation reply", () => {
  it("accepts a reply that covers every eligible QA ID exactly once", () => {
    const r = validateQuestionReply(reply([pd(), oms()]), request);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.coverage).toEqual({ evaluated: true, expected: 3, assigned: 3, missing: [], duplicated: [], unknown: [], conversational: [] });
    expect(r.questions.map((q) => [q.questionId, q.cleanQuestion, q.qaIds, q.answerEvaluation])).toEqual([
      ["CQ-001", "Who is the project director of Mimosa?", ["QA-0001", "QA-0002"], "NOT_ANSWERED"],
      ["CQ-002", "Where are the links to the Operations OMS?", ["QA-0004"], "ANSWERED"],
    ]);
  });

  it("keeps the clean question as written and copies no original text into it", () => {
    const [q] = validateQuestionReply(reply([pd(), oms()]), request).questions;
    expect(Object.keys(q).sort()).toEqual(["answerEvaluation", "cleanQuestion", "notes", "qaIds", "questionId"]);
  });

  it("rejects a missing QA ID", () => {
    const r = validateQuestionReply(reply([pd({ qaIds: ["QA-0001"] }), oms()]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage).toMatchObject({ assigned: 2, missing: ["QA-0002"] });
    expect(r.questions).toEqual([]);
  });

  it("rejects a QA ID assigned twice — within one question or across two", () => {
    expect(validateQuestionReply(reply([pd(), oms({ qaIds: ["QA-0004", "QA-0002"] })]), request).coverage.duplicated).toEqual(["QA-0002"]);
    expect(validateQuestionReply(reply([pd({ qaIds: ["QA-0001", "QA-0002", "QA-0001"] }), oms()]), request).coverage.duplicated).toEqual(["QA-0001"]);
  });

  it("rejects an invented QA ID", () => {
    const r = validateQuestionReply(reply([pd(), oms({ qaIds: ["QA-0004", "QA-9999"] })]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage.unknown).toEqual(["QA-9999"]);
  });

  it("rejects a conversational QA ID that was never sent", () => {
    const r = validateQuestionReply(reply([pd(), oms({ qaIds: ["QA-0004", "QA-0003"] })]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage.conversational).toEqual(["QA-0003"]);
  });

  it("rejects a reply to a different package", () => {
    const r = validateQuestionReply(reply([pd(), oms()], { packageId: "PKG-00000000" }), request);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/current package is PKG-/);
  });

  it.each([
    ["no cleanQuestion", { cleanQuestion: "" }, /cleanQuestion is missing/],
    ["an unknown answer evaluation", { answerEvaluation: "MAYBE" }, /answerEvaluation must be one of/],
    ["empty qaIds", { qaIds: [] }, /non-empty list/],
    ["no questionId", { questionId: undefined }, /questionId is missing/],
  ])("rejects a question with %s", (_, over, message) => {
    const r = validateQuestionReply(reply([pd(over), oms()]), request);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(message);
  });

  it("rejects duplicate question IDs", () => {
    expect(validateQuestionReply(reply([pd(), oms({ questionId: "CQ-001" })]), request).errors.join("\n")).toMatch(/used more than once/);
  });

  it("warns when a group whose questions got no reply at all is marked answered", async () => {
    const split = [pd({ qaIds: ["QA-0001"] }), pd({ questionId: "CQ-003", qaIds: ["QA-0002"], answerEvaluation: "ANSWERED" }), oms()];
    const r = validateQuestionReply(reply(split), request);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/CQ-003: evaluated ANSWERED, but none of its questions got a reply/);
  });

  it("ignores unexpected fields — such as an answer it was told not to write — with a warning", () => {
    const r = validateQuestionReply(reply([pd({ answer: "Jane Doe is the PD." }), oms()]), request);
    expect(r.ok).toBe(true);
    expect(r.questions[0]).not.toHaveProperty("answer");
    expect(r.warnings.join(" ")).toMatch(/"answer"/);
  });

  it("tolerates one surrounding ```json fence, and says so", () => {
    const r = validateQuestionReply("```json\n" + reply([pd(), oms()]) + "\n```", request);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/code fence/);
  });

  it("does not claim a coverage result for a reply it could not read", () => {
    const r = validateQuestionReply("Sure! Here are the groups…", request);
    expect(r.errors[0]).toMatch(/not valid JSON/);
    expect(r.coverage).toMatchObject({ evaluated: false, expected: 3 });
  });

  it("recognises the prompt or the input package pasted back by mistake", () => {
    const prompt = renderQuestionPrompt(request);
    expect(validateQuestionReply(prompt, request).errors[0]).toMatch(/This is the prompt, not Claude's reply/);
    expect(validateQuestionReply(prompt.slice(prompt.lastIndexOf("{\n  \"packageId\"")), request).errors[0]).toMatch(/This is the prompt/);
    expect(validateQuestionReply(JSON.stringify(request, null, 2), request).errors[0]).toMatch(/input package file/);
  });
});
