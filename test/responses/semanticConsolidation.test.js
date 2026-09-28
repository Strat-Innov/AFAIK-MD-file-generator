import { describe, it, expect, beforeAll } from "vitest";
import { buildInitialGroups } from "../../src/lib/responses/consolidate.js";
import {
  buildConsolidationRequest, renderConsolidationPrompt, validateConsolidationReply,
} from "../../src/lib/responses/ai/semanticConsolidation.js";
import { consolidationRecords, TRUNCATED_ANSWER } from "./fixtures.js";

let records, groups, request;
beforeAll(async () => {
  records = await consolidationRecords();
  groups = buildInitialGroups(records);
  request = buildConsolidationRequest(records, groups);
});
const reply = (questions, over = {}) => JSON.stringify({ packageId: request.packageId, questions, ...over });
const good = () => [
  { cleanQuestion: "Who is the project director of Mimosa?", groupIds: ["IG-001", "IG-002"] },
  { cleanQuestion: "Where are the links to the Operations OMS?", groupIds: ["IG-003"] },
];

describe("AI consolidation request", () => {
  it("sends each initial group once: question, times asked, a short answer excerpt — nothing identifying", () => {
    expect(request.items).toEqual([
      { groupId: "IG-001", question: "who is the PD of mimosa", askedTimes: 1, answerExcerpt: "I was unable to find any information about the PD of Mimosa." },
      { groupId: "IG-002", question: "who's the project director for mimosa", askedTimes: 1, answerExcerpt: "(no usable reply)" },
      { groupId: "IG-003", question: "links for the operations oms", askedTimes: 1, answerExcerpt: TRUNCATED_ANSWER.replace(/\s+/g, " ").trim().slice(0, 300) },
    ]);
    const prompt = renderConsolidationPrompt(request);
    expect(prompt).not.toMatch(/sessionId|Sessions test UTC\.csv|"hi"/);
  });

  it("asks for grouping and clean questions only", () => {
    const prompt = renderConsolidationPrompt(request);
    expect(prompt).toContain("find the groups that ask for the SAME information");
    expect(prompt).toContain("Do NOT merge groups just because they mention the same project, person or topic");
    expect(prompt).toContain("Do not answer it");
    expect(prompt).toContain(request.packageId);
    for (const gone of ["knowledge gap", "intent", "evaluate", "ANSWERED"]) expect(prompt).not.toContain(gone);
  });
});

describe("checking Claude's reply", () => {
  it("accepts a reply that uses every group exactly once", () => {
    const r = validateConsolidationReply(reply(good()), request);
    expect(r).toMatchObject({ ok: true, errors: [], coverage: { expected: 3, assigned: 3, missing: [], duplicated: [], unknown: [] } });
    expect(r.questions).toEqual(good());
  });

  it.each([
    ["a missing group", [good()[0]], /Missing group\(s\): IG-003/],
    ["a group used twice", [good()[0], { cleanQuestion: "x", groupIds: ["IG-003", "IG-002"] }], /used more than once: IG-002/],
    ["an unknown group", [...good(), { cleanQuestion: "x", groupIds: ["IG-999"] }], /Unknown group\(s\): IG-999/],
    ["an empty clean question", [{ ...good()[0], cleanQuestion: " " }, good()[1]], /no cleanQuestion/],
  ])("rejects %s — and applies nothing", (_, questions, message) => {
    const r = validateConsolidationReply(reply(questions), request);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(message);
    expect(r.questions).toEqual([]);
  });

  it("rejects a reply made for a different import", () => {
    expect(validateConsolidationReply(reply(good(), { packageId: "PKG-00000000" }), request).errors[0]).toMatch(/different set of questions/);
  });

  it("explains the common mistakes instead of failing obscurely", () => {
    expect(validateConsolidationReply("", request).errors[0]).toMatch(/Paste Claude's reply first/);
    expect(validateConsolidationReply(renderConsolidationPrompt(request), request).errors[0]).toMatch(/That is the prompt, not Claude's reply/);
    expect(validateConsolidationReply(JSON.stringify(request.items), request).errors[0]).toMatch(/That is the prompt/);
    expect(validateConsolidationReply("Sure! Here you go", request).errors[0]).toMatch(/not valid JSON/);
  });

  it("tolerates a ```json fence around the reply", () => {
    expect(validateConsolidationReply("```json\n" + reply(good()) + "\n```", request).ok).toBe(true);
  });
});
