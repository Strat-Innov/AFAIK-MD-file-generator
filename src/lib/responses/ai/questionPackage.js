/* ------------------------------------------------------------------ *
 * AI Question Consolidation — the request.
 *
 * Purpose: turn the real questions AFAIK users asked into a clean,
 * consolidated question list. The model is asked to do four things and
 * nothing else:
 *   1. group questions that ask for the same information;
 *   2. write one clean, reusable question per group, keeping its meaning;
 *   3. account for every QA ID exactly once;
 *   4. judge whether the agent's observed answer answered the question.
 * It is never asked to answer questions, supply facts, or decide what
 * AFAIK should contain.
 *
 * Input: every Extracted Q&A record whose question is an information
 * request. Conversational records ("hi", "hmp") stay in the raw data but
 * are left out, and the request lists them so the exclusion is visible.
 * Each item is QA ID, exact question, answer parts and answer status —
 * no session IDs or file names; the app keeps that mapping itself.
 *
 * Deterministic: the same records give the same request and prompt. The
 * package ID hashes the QA IDs and questions, so a reply can be matched
 * to the exact question set it answers.
 * ------------------------------------------------------------------ */

import { PART_KIND, QUESTION_KIND } from "../qa.js";

export const QUESTION_TASK = "QUESTION_CONSOLIDATION";
export const QUESTION_PACKAGE_VERSION = "afaik-question-consolidation/1";

export const ANSWER_EVALUATION = Object.freeze({
  ANSWERED: "ANSWERED",
  PARTIALLY_ANSWERED: "PARTIALLY_ANSWERED",
  NOT_ANSWERED: "NOT_ANSWERED",
  CANNOT_DETERMINE: "CANNOT_DETERMINE",
});

// The prompt's opening words, so a prompt pasted back by mistake can be recognised.
export const PROMPT_MARKER = "You are helping maintain AFAIK";

/* The reply the model must return, stated once and shared by the prompt
 * and the validator (questionResult.js). */
export const QUESTION_RESPONSE_SCHEMA = Object.freeze({
  packageId: "copy the packageId from the input exactly",
  questions: [{
    questionId: "CQ-001, CQ-002, … (sequential)",
    cleanQuestion: "one clear, reusable question that keeps the meaning of the originals",
    qaIds: ["every qaId asking this question"],
    answerEvaluation: Object.values(ANSWER_EVALUATION).join(" | "),
    notes: "optional: why questions were merged, an ambiguity, or a mixed evaluation",
  }],
});

// FNV-1a, 32-bit. Not security — an identity for "this exact question
// set", synchronous and dependency-free.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Answer text for the model: every part except platform usage-limit
 * notices, which carry no content (the status says it). Exact text. */
const answerPartsFor = (r) => r.answerParts.filter((p) => p.kind !== PART_KIND.UNAVAILABLE).map((p) => p.text);

/**
 * @param records  Extracted Q&A records (Layer 2)
 * @returns { task, version, packageId, items, excluded, counts }
 */
export function buildQuestionRequest(records) {
  const items = [];
  const excluded = [];
  for (const r of records) {
    if (r.questionKind !== QUESTION_KIND.INFORMATION_REQUEST) {
      excluded.push({ qaId: r.id, reason: "CONVERSATIONAL", question: r.question });
      continue;
    }
    items.push({ qaId: r.id, question: r.question, answerParts: answerPartsFor(r), answerStatus: r.answerStatus });
  }
  const packageId = `PKG-${fnv1a(JSON.stringify(items.map((i) => [i.qaId, i.question])))}`;
  return {
    task: QUESTION_TASK,
    version: QUESTION_PACKAGE_VERSION,
    packageId,
    items,
    excluded,
    counts: { records: records.length, items: items.length, excluded: excluded.length },
  };
}

export function renderQuestionPrompt(request) {
  const payload = { packageId: request.packageId, packageVersion: request.version, questions: request.items };
  return `${PROMPT_MARKER}, an internal knowledge agent. Below are real questions employees asked AFAIK, extracted word for word from its session logs, each with the agent's reply.

YOUR TASK:
1. Group the questions that ask for the same information.
2. Write one clean, reusable question for each group.
3. Judge whether the agent's reply answered the question.

RULES — GROUPING
1. Every qaId in the input appears in EXACTLY ONE group's qaIds. Do not leave any out, do not repeat any, do not invent any. A question that stands alone is a group of one.
2. Merge questions that clearly ask for the same information, however they are worded ("How much does a 1-BR unit cost at South Station?", "South Station 1BR price?" → one group). A question repeated word for word is merged, never dropped.
3. Do NOT merge questions just because they mention the same project, person or topic. "What is Mimosa Plus?", "What is the land area of Mimosa Plus?" and "Who is the PD of Mimosa Plus?" are three different questions.

RULES — CLEAN QUESTION
4. cleanQuestion is a clear, complete question in plain English that keeps the meaning of the originals. Fix spelling, expand obvious abbreviations only where the originals make them clear, and add no information, context or assumptions that are not in the originals.
5. Do NOT answer the question and do not turn it into a statement.

RULES — ANSWER EVALUATION (judge the replies shown, for the group as a whole)
6. ANSWERED: the reply directly and adequately answers the question.
   PARTIALLY_ANSWERED: the reply addresses part of the question but not all of it.
   NOT_ANSWERED: the agent did not answer — answerStatus AGENT_UNAVAILABLE or NO_RESPONSE, an explicit "could not find / not available", or an unrelated reply.
   CANNOT_DETERMINE: the transcript does not show enough to judge — for example answerStatus REDACTED.
7. answerStatus TRUNCATED only means the transcript export cut the reply off at about 500 characters. It does NOT mean the question was not answered. Judge the visible part; if it is not enough to tell, use CANNOT_DETERMINE. Never guess the missing text.
8. If the replies within a group differ (for example one answered, one unavailable), pick the evaluation that best describes whether users got the answer, and explain the mix in notes.
9. Evaluate only what the replies show. Do not judge whether the facts in a reply are correct, and do not suggest what AFAIK should contain.

OUTPUT
10. Copy packageId from the input unchanged. Number questionId CQ-001, CQ-002, … in the order you list the groups.
11. Reply with ONE JSON object and nothing else — no prose, no Markdown fences — matching this schema:

${JSON.stringify(QUESTION_RESPONSE_SCHEMA, null, 2)}

INPUT (${request.items.length} questions)

${JSON.stringify(payload, null, 2)}
`;
}
