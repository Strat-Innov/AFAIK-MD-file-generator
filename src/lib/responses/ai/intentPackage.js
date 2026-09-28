/* ------------------------------------------------------------------ *
 * Consolidation Pass 1 — intent clustering request.
 *
 * Question-first: the unit of analysis is the user's question. The
 * model is asked what people are asking for and which questions share
 * one information need, not whether AFAIK's answers were good. Answers
 * travel with their question as context and evidence only.
 *
 * Input: every Extracted Q&A record whose question is an information
 * request. Conversational records ("hi", "hmp") stay in the dataset but
 * are left out, and the request lists them so the exclusion is visible.
 *
 * Traceability: each item carries its QA ID; the reply must account
 * for every QA ID exactly once. The app keeps the QA ID → session →
 * source file mapping itself, so nothing the model says can break it.
 *
 * Deterministic: the same records give the same request and prompt,
 * byte for byte (no clock, no randomness) — a reply can always be
 * matched to the exact package it answers.
 * ------------------------------------------------------------------ */

import { PART_KIND, QUESTION_KIND } from "../qa.js";

export const INTENT_TASK = "INTENT_CLUSTERING";
export const INTENT_PACKAGE_VERSION = "afaik-intent-clustering/1";

// From the original specification's knowledge categories.
export const KNOWLEDGE_AREAS = Object.freeze([
  "INFORMATION", "PROCEDURE", "LINK / RESOURCE", "CONTACT", "POLICY", "LOCATION",
  "PROJECT INFORMATION", "EMPLOYEE / ROLE", "SYSTEM / TOOL", "FAQ", "OTHER",
]);

/* The reply the model must return. Phase 8 validates against this;
 * it is stated here so the prompt and the validator share one source. */
export const INTENT_RESPONSE_SCHEMA = Object.freeze({
  package_version: INTENT_PACKAGE_VERSION,
  intents: [{
    intent_id: "INT-001 (sequential)",
    intent_label: "short name of the information need, e.g. 'Mimosa Project Director'",
    information_need: "one sentence: what the users want to know",
    knowledge_area: `one of: ${KNOWLEDGE_AREAS.join(" | ")}`,
    qa_ids: ["every QA ID asking for this information need"],
    potential_knowledge_gap: "true | false",
    gap_evidence_qa_ids: ["QA IDs whose answer_type is NOT_FOUND or whose status shows no usable answer, supporting the gap flag"],
    notes: "optional: ambiguity, a near-duplicate intent kept separate and why",
  }],
  unassigned: [{ qa_id: "QA ID", reason: "why it fits no information need" }],
});

/** Answer text for the model: every part except platform usage-limit
 * notices, which carry no content. Exact text, parts kept separate. */
const answerPartsFor = (r) => r.answerParts.filter((p) => p.kind !== PART_KIND.UNAVAILABLE).map((p) => p.text);

/**
 * @param records  Extracted Q&A records (Layer 2)
 * @param options.includeSourceRefs  include session ID and source file
 *        per item (default true). They are for the reader's reference;
 *        traceability does not depend on them, because QA IDs map back.
 * @returns the request: { task, version, items, excluded, counts }
 */
export function buildIntentRequest(records, { includeSourceRefs = true } = {}) {
  const items = [];
  const excluded = [];
  for (const r of records) {
    if (r.questionKind !== QUESTION_KIND.INFORMATION_REQUEST) {
      excluded.push({ qa_id: r.id, reason: "CONVERSATIONAL", question: r.question });
      continue;
    }
    items.push({
      qa_id: r.id,
      question: r.question,
      answer_parts: answerPartsFor(r),
      answer_status: r.answerStatus,
      answer_type: r.answerType,
      ...(includeSourceRefs ? { session_id: r.sessionId, source_file: r.sourceFiles[0] } : {}),
    });
  }
  return {
    task: INTENT_TASK,
    version: INTENT_PACKAGE_VERSION,
    items,
    excluded,
    counts: {
      records: records.length,
      items: items.length,
      excluded: excluded.length,
      potentialKnowledgeGaps: records.filter((r) => r.potentialKnowledgeGap).length,
    },
  };
}

export function renderIntentPrompt(request) {
  const payload = { package_version: request.version, questions: request.items };
  return `You are helping maintain AFAIK, an internal knowledge agent. Below are real questions employees asked AFAIK, extracted word for word from its session logs, each with the agent's reply as context.

YOUR TASK: group the questions by INFORMATION NEED — what the user wants to know — so the AFAIK team can see what people ask for and what AFAIK should contain.

The QUESTION is the signal. The answer is context. Do not judge whether AFAIK's answers were good.

RULES
1. Every qa_id in the input appears exactly once in your reply: in one intent's qa_ids, or in "unassigned". Never invent, drop or repeat a qa_id.
2. Group questions that ask for the same information, however they are worded ("who is the PD of mimosa", "who's the project director for mimosa" → one intent). A question repeated in one session is still grouped, not dropped.
3. Do NOT group on shared keywords alone. Same subject, different need = separate intents (e.g. "price of Two Botanika" vs "payment schedule of Two Botanika").
4. intent_label and information_need describe the need in neutral words. Do not answer the question and do not add facts that are not in the input.
5. potential_knowledge_gap = true when the questions in the intent got no usable answer: answer_type NOT_FOUND, or answer_status AGENT_UNAVAILABLE, NO_RESPONSE or REDACTED for every question in it. This is a flag for human review, not a verdict. List the supporting qa_ids in gap_evidence_qa_ids.
6. answer_status TRUNCATED means the export cut the reply off: treat it as partial context, never as a complete answer. REDACTED means the reply is unavailable.
7. Use knowledge_area values exactly as listed in the schema.
8. Reply with ONE JSON object and nothing else — no prose, no Markdown fences — matching this schema:

${JSON.stringify(INTENT_RESPONSE_SCHEMA, null, 2)}

INPUT (${request.items.length} questions)

${JSON.stringify(payload, null, 2)}
`;
}
