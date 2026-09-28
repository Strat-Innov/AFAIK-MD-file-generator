import { describe, it, expect } from "vitest";
import {
  buildIntentRequest, renderIntentPrompt, INTENT_TASK, INTENT_PACKAGE_VERSION, CONFIDENCE_LEVELS,
} from "../../src/lib/responses/ai/intentPackage.js";
import { manualClaudeProvider, DEFAULT_PROVIDER } from "../../src/lib/responses/ai/provider.js";
import { TRUNCATED_ANSWER, intentRecords } from "./fixtures.js";

describe("intent consolidation request", () => {
  it("sends every information request and lists the conversational ones it leaves out", async () => {
    const req = buildIntentRequest(await intentRecords());
    expect(req).toMatchObject({ task: INTENT_TASK, version: INTENT_PACKAGE_VERSION });
    expect(req.packageId).toMatch(/^PKG-[0-9a-f]{8}$/);
    expect(req.items.map((i) => i.qaId)).toEqual(["QA-0001", "QA-0002", "QA-0004"]);
    expect(req.excluded).toEqual([{ qaId: "QA-0003", reason: "CONVERSATIONAL", question: "hi" }]);
    expect(req.counts).toEqual({ records: 4, items: 3, excluded: 1, potentialKnowledgeGaps: 1 });
  });

  it("by default sends only QA ID, question, answer, status and type — no session IDs or source files", async () => {
    const [first, second, third] = buildIntentRequest(await intentRecords()).items;
    expect(first).toEqual({
      qaId: "QA-0001", question: "who is the PD of mimosa",
      answerParts: ["I was unable to find any information about the PD of Mimosa."],
      answerStatus: "ANSWERED", answerType: "NOT_FOUND",
    });
    // Usage-limit notices carry no content and are left out of the answer; the status says it.
    expect(second).toEqual({ qaId: "QA-0002", question: "who's the project director for mimosa", answerParts: [], answerStatus: "AGENT_UNAVAILABLE", answerType: null });
    // A truncated reply's question is sent like any other, with its visible text as context.
    expect(third).toMatchObject({ qaId: "QA-0004", answerStatus: "TRUNCATED", answerParts: [TRUNCATED_ANSWER] });
  });

  it("adds session ID and source file only when asked, without changing the package ID", async () => {
    const recs = await intentRecords();
    const plain = buildIntentRequest(recs);
    const withRefs = buildIntentRequest(recs, { includeSourceRefs: true });
    expect(withRefs.items[0]).toMatchObject({ sessionId: "s-1", sourceFile: "Sessions test UTC.csv" });
    expect(withRefs.packageId).toBe(plain.packageId);
  });

  it("gives a different package ID when the question set changes", async () => {
    const recs = await intentRecords();
    expect(buildIntentRequest(recs.slice(0, 2)).packageId).not.toBe(buildIntentRequest(recs).packageId);
  });

  it("renders a prompt with the rules, the schema, the package ID and every QA ID sent — and no excluded one", async () => {
    const req = buildIntentRequest(await intentRecords());
    const prompt = renderIntentPrompt(req);
    for (const id of ["QA-0001", "QA-0002", "QA-0004"]) expect(prompt).toContain(`"qaId": "${id}"`);
    expect(prompt).not.toContain('"qaId": "QA-0003"');
    expect(prompt).toContain("The QUESTION is the signal. The answer is context.");
    expect(prompt).toContain("EXACTLY ONE intent");
    expect(prompt).toContain("Do NOT answer the questions");
    expect(prompt).toContain("Never infer a gap from the absence of an answer");
    expect(prompt).toContain("It sets neither flag");
    for (const f of ["intentId", "intentTitle", "informationNeed", "qaIds", "potentialKnowledgeGap", "unansweredDemand", "gapRationale", "confidence", "notes"]) {
      expect(prompt).toContain(`"${f}"`);
    }
    for (const c of CONFIDENCE_LEVELS) expect(prompt).toContain(c);
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf("INPUT (")).replace(/^INPUT \(\d+ questions\)\s*/, ""));
    expect(input.packageId).toBe(req.packageId);
    expect(input.questions).toEqual(req.items);
  });

  it("is deterministic: same records, same prompt, byte for byte", async () => {
    const a = renderIntentPrompt(buildIntentRequest(await intentRecords()));
    const b = renderIntentPrompt(buildIntentRequest(await intentRecords()));
    expect(a).toBe(b);
  });
});

describe("AI provider abstraction", () => {
  it("v1's default provider is manual and never sends data by itself", () => {
    expect(DEFAULT_PROVIDER).toBe(manualClaudeProvider);
    expect(manualClaudeProvider.automatic).toBe(false);
  });

  it("renders a request through the provider interface, and refuses unknown tasks", async () => {
    const req = buildIntentRequest(await intentRecords());
    expect(manualClaudeProvider.render(req).promptText).toBe(renderIntentPrompt(req));
    expect(() => manualClaudeProvider.render({ task: "SOMETHING_ELSE" })).toThrow(/No prompt renderer/);
  });
});
