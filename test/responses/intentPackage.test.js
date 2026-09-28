import { describe, it, expect } from "vitest";
import { readResponseFile, mergeImport, EMPTY_WORKSPACE } from "../../src/lib/responses/importSessions.js";
import { extractQA } from "../../src/lib/responses/qa.js";
import {
  buildIntentRequest, renderIntentPrompt, INTENT_TASK, INTENT_PACKAGE_VERSION, KNOWLEDGE_AREAS,
} from "../../src/lib/responses/ai/intentPackage.js";
import { manualClaudeProvider, DEFAULT_PROVIDER } from "../../src/lib/responses/ai/provider.js";
import { ROWS, toCsv, fileFrom, tx, GREETING, UNAVAILABLE_NOTICE, TRUNCATED_ANSWER } from "./fixtures.js";

async function records() {
  const row = (id, transcript, turns) => { const r = [...ROWS[0]]; r[0] = id; r[5] = String(turns); r[6] = transcript; return r; };
  const csv = toCsv([
    row("s-1", tx(["Agent", GREETING], ["User", "who is the PD of mimosa"], ["Agent", "I was unable to find any information about the PD of Mimosa."],
      ["User", "who's the project director for mimosa"], ["Agent", UNAVAILABLE_NOTICE]), 5),
    row("s-2", tx(["User", "hi"], ["Agent", "Bot said:Hi! I'm your assistant."], ["User", "links for the operations oms"], ["Agent", TRUNCATED_ANSWER]), 4),
  ]);
  const parsed = [await readResponseFile(fileFrom("Sessions test UTC.csv", csv))];
  return extractQA(mergeImport(EMPTY_WORKSPACE, parsed, "x").workspace.sessions).records;
}

describe("Pass 1 intent-clustering request", () => {
  it("sends every information request and lists the conversational ones it leaves out", async () => {
    const req = buildIntentRequest(await records());
    expect(req).toMatchObject({ task: INTENT_TASK, version: INTENT_PACKAGE_VERSION });
    expect(req.items.map((i) => i.qa_id)).toEqual(["QA-0001", "QA-0002", "QA-0004"]);
    expect(req.excluded).toEqual([{ qa_id: "QA-0003", reason: "CONVERSATIONAL", question: "hi" }]);
    expect(req.counts).toEqual({ records: 4, items: 3, excluded: 1, potentialKnowledgeGaps: 1 });
  });

  it("carries the exact question and answer text, status, type and source refs", async () => {
    const [first, second, third] = buildIntentRequest(await records()).items;
    expect(first).toEqual({
      qa_id: "QA-0001", question: "who is the PD of mimosa",
      answer_parts: ["I was unable to find any information about the PD of Mimosa."],
      answer_status: "ANSWERED", answer_type: "NOT_FOUND",
      session_id: "s-1", source_file: "Sessions test UTC.csv",
    });
    // Usage-limit notices carry no content and are left out of the answer; the status says it.
    expect(second).toMatchObject({ question: "who's the project director for mimosa", answer_parts: [], answer_status: "AGENT_UNAVAILABLE", answer_type: null });
    expect(third.answer_parts).toEqual([TRUNCATED_ANSWER]);
  });

  it("can leave out session IDs and source files — QA IDs still trace back", async () => {
    const item = buildIntentRequest(await records(), { includeSourceRefs: false }).items[0];
    expect(item).not.toHaveProperty("session_id");
    expect(item).not.toHaveProperty("source_file");
    expect(item.qa_id).toBe("QA-0001");
  });

  it("renders a prompt with the rules, the schema, and every QA ID sent — and no excluded one", async () => {
    const req = buildIntentRequest(await records());
    const prompt = renderIntentPrompt(req);
    for (const id of ["QA-0001", "QA-0002", "QA-0004"]) expect(prompt).toContain(`"qa_id": "${id}"`);
    expect(prompt).not.toContain('"qa_id": "QA-0003"');
    expect(prompt).toContain("The QUESTION is the signal. The answer is context.");
    expect(prompt).toContain("exactly once");
    expect(prompt).toContain("potential_knowledge_gap");
    for (const area of KNOWLEDGE_AREAS) expect(prompt).toContain(area);
    // The input block is valid JSON the reply can be checked against.
    const input = JSON.parse(prompt.slice(prompt.lastIndexOf("INPUT (")).replace(/^INPUT \(\d+ questions\)\s*/, ""));
    expect(input.questions).toEqual(req.items);
  });

  it("is deterministic: same records, same prompt, byte for byte", async () => {
    const a = renderIntentPrompt(buildIntentRequest(await records()));
    const b = renderIntentPrompt(buildIntentRequest(await records()));
    expect(a).toBe(b);
  });
});

describe("AI provider abstraction", () => {
  it("v1's default provider is manual and never sends data by itself", () => {
    expect(DEFAULT_PROVIDER).toBe(manualClaudeProvider);
    expect(manualClaudeProvider.automatic).toBe(false);
  });

  it("renders a request through the provider interface, and refuses unknown tasks", async () => {
    const req = buildIntentRequest(await records());
    expect(manualClaudeProvider.render(req).promptText).toBe(renderIntentPrompt(req));
    expect(() => manualClaudeProvider.render({ task: "SOMETHING_ELSE" })).toThrow(/No prompt renderer/);
  });
});
