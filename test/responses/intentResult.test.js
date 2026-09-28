import { describe, it, expect, beforeAll } from "vitest";
import { buildIntentRequest } from "../../src/lib/responses/ai/intentPackage.js";
import { validateIntentReply, REVIEW_STATUS } from "../../src/lib/responses/ai/intentResult.js";
import { intentRecords } from "./fixtures.js";

let request;
beforeAll(async () => { request = buildIntentRequest(await intentRecords()); });

const intent = (over = {}) => ({
  intentId: "INT-001",
  intentTitle: "Mimosa Project Director",
  informationNeed: "Users want to know who the project director of Mimosa is.",
  qaIds: ["QA-0001", "QA-0002"],
  potentialKnowledgeGap: true,   // QA-0001's reply says not found
  unansweredDemand: true,        // QA-0002 hit the usage limit
  gapRationale: "One reply says no information about the PD of Mimosa was found.",
  confidence: "high",
  notes: "",
  ...over,
});
const oms = (over = {}) => intent({
  intentId: "INT-002", intentTitle: "Operations OMS links", informationNeed: "Users want the links to the Operations OMS.",
  qaIds: ["QA-0004"], potentialKnowledgeGap: false, unansweredDemand: false, gapRationale: "", confidence: "medium", ...over,
});
const reply = (intents, over = {}) => JSON.stringify({ packageId: request.packageId, intents, ...over });

describe("validating Claude's intent reply", () => {
  it("accepts a reply that covers every QA ID exactly once", () => {
    const r = validateIntentReply(reply([intent(), oms()]), request);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.coverage).toEqual({ evaluated: true, expected: 3, assigned: 3, missing: [], truncatedMissing: [], duplicated: [], unknown: [], conversational: [] });
    expect(r.warnings).toEqual([]);
    expect(r.intents.map((i) => [i.intentId, i.qaIds, i.reviewStatus])).toEqual([
      ["INT-001", ["QA-0001", "QA-0002"], REVIEW_STATUS.PENDING],
      ["INT-002", ["QA-0004"], REVIEW_STATUS.PENDING],
    ]);
  });

  it("keeps the model's wording and adds no question or answer text of its own", () => {
    const [it0] = validateIntentReply(reply([intent(), oms()]), request).intents;
    expect(it0.intentTitle).toBe("Mimosa Project Director");
    expect(Object.keys(it0).sort()).toEqual(
      ["confidence", "gapRationale", "informationNeed", "intentId", "intentTitle", "notes", "potentialKnowledgeGap", "qaIds", "reviewStatus", "unansweredDemand"],
    );
  });

  it("rejects a missing QA ID", () => {
    const r = validateIntentReply(reply([intent({ qaIds: ["QA-0001"] }), oms()]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage).toMatchObject({ assigned: 2, missing: ["QA-0002"] });
    expect(r.intents).toEqual([]);
  });

  it("rejects a QA ID assigned twice — within one intent or across two", () => {
    const across = validateIntentReply(reply([intent(), oms({ qaIds: ["QA-0004", "QA-0002"] })]), request);
    expect(across.ok).toBe(false);
    expect(across.coverage.duplicated).toEqual(["QA-0002"]);
    const within = validateIntentReply(reply([intent({ qaIds: ["QA-0001", "QA-0002", "QA-0001"] }), oms()]), request);
    expect(within.coverage.duplicated).toEqual(["QA-0001"]);
  });

  it("rejects an invented QA ID", () => {
    const r = validateIntentReply(reply([intent(), oms({ qaIds: ["QA-0004", "QA-9999"] })]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage.unknown).toEqual(["QA-9999"]);
  });

  it("rejects a conversational QA ID that was never sent", () => {
    const r = validateIntentReply(reply([intent(), oms({ qaIds: ["QA-0004", "QA-0003"] })]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage.conversational).toEqual(["QA-0003"]);
    expect(r.coverage.unknown).toEqual([]);
  });

  it("rejects a reply to a different package", () => {
    const r = validateIntentReply(reply([intent(), oms()], { packageId: "PKG-00000000" }), request);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/current package is PKG-/);
    expect(validateIntentReply(JSON.stringify({ intents: [intent(), oms()] }), request).errors[0]).toMatch(/no packageId/);
  });

  it.each([
    ["no intentTitle", { intentTitle: "" }, /intentTitle is missing/],
    ["no informationNeed", { informationNeed: undefined }, /informationNeed is missing/],
    ["gap without rationale", { gapRationale: "" }, /needs a gapRationale/],
    ["gap as text", { potentialKnowledgeGap: "yes" }, /must be true or false/],
    ["unknown confidence", { confidence: "certain" }, /confidence must be one of/],
    ["empty qaIds", { qaIds: [] }, /non-empty list/],
  ])("rejects an intent with %s", (_, over, message) => {
    const r = validateIntentReply(reply([intent(over), oms()]), request);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(message);
  });

  it("rejects duplicate intent IDs", () => {
    const r = validateIntentReply(reply([intent(), oms({ intentId: "INT-001" })]), request);
    expect(r.errors.join("\n")).toMatch(/intentId is used more than once/);
  });

  it("rejects text that is not one JSON object", () => {
    expect(validateIntentReply("Here are the intents: …", request).errors[0]).toMatch(/not valid JSON/);
    expect(validateIntentReply("", request).errors[0]).toMatch(/empty/);
    expect(validateIntentReply("[]", request).errors[0]).toMatch(/one JSON object/);
    expect(validateIntentReply(JSON.stringify({ packageId: request.packageId, intents: [] }), request).ok).toBe(false);
  });

  it("tolerates one surrounding ```json fence, and says so", () => {
    const r = validateIntentReply("```json\n" + reply([intent(), oms()]) + "\n```", request);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/code fence/);
  });

  it("ignores unexpected fields — such as an answer the model was told not to write — with a warning", () => {
    const r = validateIntentReply(reply([intent({ canonicalAnswer: "Jane Doe is the PD." }), oms()]), request);
    expect(r.ok).toBe(true);
    expect(r.intents[0]).not.toHaveProperty("canonicalAnswer");
    expect(r.warnings.join(" ")).toMatch(/"canonicalAnswer"/);
  });

  it("normalises confidence case", () => {
    expect(validateIntentReply(reply([intent({ confidence: "High" }), oms()]), request).intents[0].confidence).toBe("high");
  });
});

describe("coverage reporting", () => {
  it("does not claim a coverage result for a reply it could not read", async () => {
    const request = buildIntentRequest(await intentRecords());
    expect(validateIntentReply("not json", request).coverage).toMatchObject({ evaluated: false, expected: 3 });
  });
});

describe("pasting the prompt back by mistake", () => {
  it("says so plainly, for the whole prompt or just its input block", async () => {
    const { renderIntentPrompt } = await import("../../src/lib/responses/ai/intentPackage.js");
    const request = buildIntentRequest(await intentRecords());
    const prompt = renderIntentPrompt(request);
    for (const pasted of [prompt, prompt.slice(prompt.lastIndexOf("{\n  \"packageId\""))]) {
      const r = validateIntentReply(pasted, request);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatch(/This is the prompt, not Claude's reply/);
    }
  });
});

describe("pasting the package file back by mistake", () => {
  it("says it is the package, not Claude's reply", () => {
    const r = validateIntentReply(JSON.stringify(request, null, 2), request);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/This is the package file .* not Claude's reply/);
  });
});

describe("potential knowledge gap vs unanswered demand", () => {
  it("mixed evidence — a not-found reply and an unavailable one — sets both flags", () => {
    const r = validateIntentReply(reply([intent(), oms()]), request);
    expect(r.intents[0]).toMatchObject({ potentialKnowledgeGap: true, unansweredDemand: true });
  });

  it("requires unansweredDemand on every intent", () => {
    const { unansweredDemand, ...without } = intent();
    const r = validateIntentReply(reply([without, oms()]), request);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/unansweredDemand must be true or false/);
  });

  it("rejects an unansweredDemand flag that contradicts the answer statuses", () => {
    const missed = validateIntentReply(reply([intent({ unansweredDemand: false }), oms()]), request);
    expect(missed.ok).toBe(false);
    expect(missed.errors[0]).toMatch(/INT-001: unansweredDemand must be true — .*QA-0002 AGENT_UNAVAILABLE/);
    // Truncation is an export limit, not an unanswered question.
    const invented = validateIntentReply(reply([intent(), oms({ unansweredDemand: true })]), request);
    expect(invented.ok).toBe(false);
    expect(invented.errors[0]).toMatch(/INT-002: unansweredDemand must be false/);
  });

  it("unanswered-only intents are demand, not gaps", () => {
    const split = [
      intent({ intentId: "INT-001", qaIds: ["QA-0001"], unansweredDemand: false }),
      intent({ intentId: "INT-003", qaIds: ["QA-0002"], potentialKnowledgeGap: false, unansweredDemand: true, gapRationale: null }),
      oms(),
    ];
    const r = validateIntentReply(reply(split), request);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.intents[1]).toMatchObject({ potentialKnowledgeGap: false, unansweredDemand: true, gapRationale: "" });
  });

  it("warns when a gap is flagged without not-found evidence — e.g. for truncation or unavailability", () => {
    const r = validateIntentReply(reply([intent(), oms({ potentialKnowledgeGap: true, gapRationale: "The reply was cut off." })]), request);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/INT-002: flagged as a potential knowledge gap, but none of its questions/);
  });

  it("warns when not-found evidence is present but no gap is flagged", () => {
    const r = validateIntentReply(reply([intent({ potentialKnowledgeGap: false, gapRationale: "" }), oms()]), request);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/INT-001: not flagged as a potential knowledge gap, although QA-0001/);
  });

  it("names a truncated question that was left out", () => {
    const r = validateIntentReply(reply([intent()]), request);
    expect(r.ok).toBe(false);
    expect(r.coverage.truncatedMissing).toEqual(["QA-0004"]);
    expect(r.errors.join("\n")).toMatch(/truncated questions, which must always be included: QA-0004/);
  });
});
