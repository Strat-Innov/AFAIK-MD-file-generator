import { describe, it, expect } from "vitest";
import {
  buildQuestionRequest, renderQuestionPrompt, QUESTION_TASK, QUESTION_PACKAGE_VERSION, ANSWER_EVALUATION,
} from "../../src/lib/responses/ai/questionPackage.js";
import { manualClaudeProvider, DEFAULT_PROVIDER } from "../../src/lib/responses/ai/provider.js";
import { TRUNCATED_ANSWER, consolidationRecords } from "./fixtures.js";

describe("question consolidation request", () => {
  it("sends every information question and lists the conversational ones it leaves out", async () => {
    const req = buildQuestionRequest(await consolidationRecords());
    expect(req).toMatchObject({ task: QUESTION_TASK, version: QUESTION_PACKAGE_VERSION });
    expect(req.packageId).toMatch(/^PKG-[0-9a-f]{8}$/);
    expect(req.items.map((i) => i.qaId)).toEqual(["QA-0001", "QA-0002", "QA-0004"]);
    expect(req.excluded).toEqual([{ qaId: "QA-0003", reason: "CONVERSATIONAL", question: "hi" }]);
    expect(req.counts).toEqual({ records: 4, items: 3, excluded: 1 });
  });

  it("sends only QA ID, exact question, answer parts and answer status — no session IDs or file names", async () => {
    const [first, second, third] = buildQuestionRequest(await consolidationRecords()).items;
    expect(first).toEqual({
      qaId: "QA-0001", question: "who is the PD of mimosa",
      answerParts: ["I was unable to find any information about the PD of Mimosa."], answerStatus: "ANSWERED",
    });
    // Usage-limit notices carry no content and are left out; the status says it.
    expect(second).toEqual({ qaId: "QA-0002", question: "who's the project director for mimosa", answerParts: [], answerStatus: "AGENT_UNAVAILABLE" });
    // A truncated reply's question is sent like any other, with its visible text.
    expect(third).toEqual({ qaId: "QA-0004", question: "links for the operations oms", answerParts: [TRUNCATED_ANSWER], answerStatus: "TRUNCATED" });
  });

  it("gives a different package ID when the question set changes", async () => {
    const recs = await consolidationRecords();
    expect(buildQuestionRequest(recs.slice(0, 2)).packageId).not.toBe(buildQuestionRequest(recs).packageId);
  });

  it("renders a prompt that asks for grouping, clean questions and answer evaluation — and nothing else", async () => {
    const req = buildQuestionRequest(await consolidationRecords());
    const prompt = renderQuestionPrompt(req);
    for (const id of ["QA-0001", "QA-0002", "QA-0004"]) expect(prompt).toContain(`"qaId": "${id}"`);
    expect(prompt).not.toContain('"qaId": "QA-0003"');
    expect(prompt).toContain("EXACTLY ONE group");
    expect(prompt).toContain("Do NOT merge questions just because they mention the same project, person or topic");
    expect(prompt).toContain("Do NOT answer the question");
    expect(prompt).toContain("It does NOT mean the question was not answered");
    for (const f of ["questionId", "cleanQuestion", "qaIds", "answerEvaluation", "notes"]) expect(prompt).toContain(`"${f}"`);
    for (const v of Object.values(ANSWER_EVALUATION)) expect(prompt).toContain(v);
    // None of the retired concepts leak back in.
    for (const gone of ["potentialKnowledgeGap", "unansweredDemand", "intent", "knowledge gap"]) expect(prompt).not.toContain(gone);
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf("INPUT (")).replace(/^INPUT \(\d+ questions\)\s*/, ""));
    expect(input.packageId).toBe(req.packageId);
    expect(input.questions).toEqual(req.items);
  });

  it("is deterministic: same records, same prompt, byte for byte", async () => {
    const a = renderQuestionPrompt(buildQuestionRequest(await consolidationRecords()));
    const b = renderQuestionPrompt(buildQuestionRequest(await consolidationRecords()));
    expect(a).toBe(b);
  });
});

describe("AI provider abstraction", () => {
  it("v1's default provider is manual and never sends data by itself", () => {
    expect(DEFAULT_PROVIDER).toBe(manualClaudeProvider);
    expect(manualClaudeProvider.automatic).toBe(false);
  });

  it("renders a request through the provider interface, and refuses unknown tasks", async () => {
    const req = buildQuestionRequest(await consolidationRecords());
    expect(manualClaudeProvider.render(req).promptText).toBe(renderQuestionPrompt(req));
    expect(() => manualClaudeProvider.render({ task: "SOMETHING_ELSE" })).toThrow(/No prompt renderer/);
  });
});
