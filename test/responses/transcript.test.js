import { describe, it, expect } from "vitest";
import { parseTranscript, SPEAKER, PARSE_STATUS } from "../../src/lib/responses/transcript.js";
import { tx, GREETING, UNAVAILABLE_NOTICE, TRUNCATED_ANSWER, MULTI_QUESTION_TRANSCRIPT } from "./fixtures.js";

const shape = (r) => r.entries.map((e) => (e.speaker === SPEAKER.USER ? "U" : e.speaker === SPEAKER.AGENT ? "A" : e.speaker));
const texts = (r) => r.entries.map((e) => e.text);
const roundTrips = (t, r) => expect(r.entries.map((e) => e.source).join("")).toBe(t);

describe("transcript parser — real export structure", () => {
  it("reads User → Agent", () => {
    const t = tx(["User", "hectares of mimosa plus"], ["Agent", "Mimosa Plus covers 200 hectares."]);
    const r = parseTranscript(t, 2);
    expect(shape(r)).toEqual(["U", "A"]);
    expect(texts(r)).toEqual(["hectares of mimosa plus", "Mimosa Plus covers 200 hectares."]);
    expect(r.parseStatus).toBe(PARSE_STATUS.OK);
    roundTrips(t, r);
  });

  it("reads Agent preamble → User → Agent", () => {
    const t = tx(["Agent", GREETING], ["User", "how to file a permit?"], ["Agent", "Use the permits system."]);
    const r = parseTranscript(t, 3);
    expect(shape(r)).toEqual(["A", "U", "A"]);
    expect(r.entries.map((e) => e.index)).toEqual([1, 2, 3]);
  });

  it("reads several questions in one session, in order", () => {
    const r = parseTranscript(MULTI_QUESTION_TRANSCRIPT, 7);
    expect(shape(r)).toEqual(["A", "U", "A", "U", "A", "U", "A"]);
    expect(r.entries.filter((e) => e.speaker === SPEAKER.USER).map((e) => e.text))
      .toEqual(["give me oms for operations", "give me the links", "give me the links for operations OMS"]);
    roundTrips(MULTI_QUESTION_TRANSCRIPT, r);
  });

  it("reads an agent-only session (greeting + unavailable notice)", () => {
    const r = parseTranscript(tx(["Agent", GREETING], ["Agent", UNAVAILABLE_NOTICE]), 2);
    expect(shape(r)).toEqual(["A", "A"]);
    expect(r.entries[1].text).toBe(UNAVAILABLE_NOTICE);
  });

  it('keeps "Bot said:" inside the Agent message — it is not a speaker', () => {
    const t = tx(["User", "hi"], ["Agent", "Bot said:Hi! I'm **AFAIK MD NEW DATA** your virtual assistant."]);
    const r = parseTranscript(t, 2);
    expect(shape(r)).toEqual(["U", "A"]);
    expect(r.entries[1].text).toBe("Bot said:Hi! I'm **AFAIK MD NEW DATA** your virtual assistant.");
    expect(r.parseStatus).toBe(PARSE_STATUS.OK);
  });

  it("keeps message text exactly — spaces, Markdown, URLs, a truncated tail", () => {
    const t = tx(["User", " at  South Station how much? "], ["Agent", TRUNCATED_ANSWER], ["Agent", "[REDACTED]"]);
    const r = parseTranscript(t, 3);
    expect(texts(r)).toEqual([" at  South Station how much? ", TRUNCATED_ANSWER, "[REDACTED]"]);
    roundTrips(t, r);
  });

  it("flags PARSE_MISMATCH when the entry count differs from Turns", () => {
    const t = tx(["User", "q"], ["Agent", "a"]);
    expect(parseTranscript(t, 3)).toMatchObject({ parseStatus: PARSE_STATUS.PARSE_MISMATCH, parseFlags: [PARSE_STATUS.PARSE_MISMATCH] });
    expect(parseTranscript(t, 2).parseStatus).toBe(PARSE_STATUS.OK);
    expect(parseTranscript(t, null).parseStatus).toBe(PARSE_STATUS.OK); // no Turns column: nothing to check against
  });

  it("keeps an unknown speaker as its own entry and flags it", () => {
    const t = tx(["Agent", GREETING], ["System", "maintenance window"], ["User", "q"], ["Agent", "a"]);
    const r = parseTranscript(t, 4);
    expect(shape(r)).toEqual(["A", SPEAKER.UNKNOWN, "U", "A"]);
    expect(r.entries[1]).toMatchObject({ marker: "System says", text: "maintenance window" });
    expect(r.parseStatus).toBe(PARSE_STATUS.UNKNOWN_SPEAKER);
    roundTrips(t, r);
  });

  it("keeps text before the first marker as UNPARSED, outside the turn count", () => {
    const t = "Conversation started;" + tx(["User", "q"], ["Agent", "a"]);
    const r = parseTranscript(t, 2);
    expect(r.entries[0]).toMatchObject({ speaker: SPEAKER.UNPARSED, index: null, text: "Conversation started;" });
    expect(r.entries.slice(1).map((e) => e.index)).toEqual([1, 2]);
    expect(r.parseFlags).toEqual([PARSE_STATUS.UNPARSED_CONTENT]);
    roundTrips(t, r);
  });

  it("keeps a transcript with no markers at all as one UNPARSED entry", () => {
    const t = "free text with no speaker labels";
    const r = parseTranscript(t, 1);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ speaker: SPEAKER.UNPARSED, text: t });
    // Both problems are recorded; the more fundamental one leads.
    expect(r.parseFlags).toEqual([PARSE_STATUS.PARSE_MISMATCH, PARSE_STATUS.UNPARSED_CONTENT]);
  });

  it("reports an empty transcript as NO_TRANSCRIPT", () => {
    expect(parseTranscript("", 0)).toEqual({ entries: [], parseStatus: PARSE_STATUS.NO_TRANSCRIPT, parseFlags: [PARSE_STATUS.NO_TRANSCRIPT] });
  });

  it("handles a last entry without its terminating ';' and an empty message", () => {
    const t = "User says: q;Agent says: ;User says: again";
    const r = parseTranscript(t, 3);
    expect(texts(r)).toEqual(["q", "", "again"]);
    roundTrips(t, r);
  });

  it("does not split on a speaker-like phrase inside a message", () => {
    const t = tx(["Agent", "The policy says: apply early. Our manager said: yes."]);
    const r = parseTranscript(t, 1);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].text).toBe("The policy says: apply early. Our manager said: yes.");
  });
});
