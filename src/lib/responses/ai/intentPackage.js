/* ------------------------------------------------------------------ *
 * AI Intent Consolidation — the request.
 *
 * Question-first: the unit of analysis is the user's question. The
 * model is asked what people are asking for and which questions share
 * one information need — not whether AFAIK's answers were good, and not
 * to answer anything. Answers travel with their question as context.
 *
 * Input: every Extracted Q&A record whose question is an information
 * request. Conversational records ("hi", "hmp") stay in the dataset but
 * are left out, and the request lists them so the exclusion is visible.
 *
 * Data minimisation: by default an item is QA ID, question, answer
 * parts, answer status and answer type. Session IDs and source files
 * are opt-in — the model does not need them to judge intent, and the
 * app keeps the QA ID → session → source file mapping itself.
 *
 * Deterministic: the same records give the same request and prompt,
 * byte for byte. The package ID is a hash of the QA IDs and questions,
 * so a reply can be matched to the exact question set it answers.
 * ------------------------------------------------------------------ */

import { PART_KIND, QUESTION_KIND } from "../qa.js";

export const INTENT_TASK = "INTENT_CONSOLIDATION";
export const INTENT_PACKAGE_VERSION = "afaik-intent-consolidation/1";
export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);

/* The reply the model must return, stated once and shared by the prompt
 * and the validator (intentResult.js). */
export const INTENT_RESPONSE_SCHEMA = Object.freeze({
  packageId: "copy the packageId from the input exactly",
  intents: [{
    intentId: "INT-001, INT-002, … (sequential)",
    intentTitle: "short name of the information need, e.g. 'Mimosa Project Director'",
    informationNeed: "one sentence: what these users want to know",
    qaIds: ["every qaId asking for this information need"],
    potentialKnowledgeGap: "true | false — true ONLY with explicit not-found evidence (rule 5)",
    unansweredDemand: "true | false — true when any question in the intent got no usable answer content (rule 6)",
    gapRationale: "the not-found evidence, when potentialKnowledgeGap is true; otherwise empty string or null",
    confidence: CONFIDENCE_LEVELS.join(" | "),
    notes: "optional: ambiguity, or a related intent you kept separate and why",
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
 * notices, which carry no content. Exact text, parts kept separate. */
const answerPartsFor = (r) => r.answerParts.filter((p) => p.kind !== PART_KIND.UNAVAILABLE).map((p) => p.text);

/**
 * @param records  Extracted Q&A records (Layer 2)
 * @param options.includeSourceRefs  add session ID and source file per
 *        item. Off by default (data minimisation).
 * @returns { task, version, packageId, items, excluded, counts }
 */
export function buildIntentRequest(records, { includeSourceRefs = false } = {}) {
  const items = [];
  const excluded = [];
  for (const r of records) {
    if (r.questionKind !== QUESTION_KIND.INFORMATION_REQUEST) {
      excluded.push({ qaId: r.id, reason: "CONVERSATIONAL", question: r.question });
      continue;
    }
    items.push({
      qaId: r.id,
      question: r.question,
      answerParts: answerPartsFor(r),
      answerStatus: r.answerStatus,
      answerType: r.answerType,
      ...(includeSourceRefs ? { sessionId: r.sessionId, sourceFile: r.sourceFiles[0] } : {}),
    });
  }
  // Identity covers what the model groups — the questions — not the
  // opt-in reference fields, so toggling those keeps the same package.
  const packageId = `PKG-${fnv1a(JSON.stringify(items.map((i) => [i.qaId, i.question])))}`;
  return {
    task: INTENT_TASK,
    version: INTENT_PACKAGE_VERSION,
    packageId,
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

// The prompt's opening words, so a prompt pasted back by mistake can be recognised.
export const PROMPT_MARKER = "You are helping maintain AFAIK";

export function renderIntentPrompt(request) {
  const payload = { packageId: request.packageId, packageVersion: request.version, questions: request.items };
  return `${PROMPT_MARKER}, an internal knowledge agent. Below are real questions employees asked AFAIK, extracted word for word from its session logs, each with the agent's reply as context.

YOUR TASK: group the questions by INFORMATION NEED — what the user wants to know — so the AFAIK team can see what people ask for and what AFAIK may need to contain.

The QUESTION is the signal. The answer is context. Focus on "what is this user looking for?", not on "how good was the answer?". A poor, wrong or empty answer never makes a question less important.

RULES
1. Every qaId in the input appears in EXACTLY ONE intent's qaIds. Do not leave any out, do not repeat any, do not invent any. A question that stands alone becomes an intent of its own.
2. Group questions that ask for the same information, however they are worded ("who is the PD of mimosa", "who's the project director for mimosa", "who handles the mimosa project" → one intent). A question asked twice in a session is still grouped, never dropped.
3. Do NOT group on shared keywords alone. Same subject, different need = separate intents (e.g. "price of Two Botanika" vs "payment schedule of Two Botanika").
4. Describe the need only. Do NOT answer the questions, do NOT state facts, do NOT write knowledge-base content. Nothing in your reply may assert information that is not in the questions.
5. potentialKnowledgeGap = true ONLY when at least one reply in the intent explicitly says the information could not be found in the configured knowledge source (e.g. "unable to find information", "not available in the configured knowledge source"; answerType NOT_FOUND usually marks these). Never infer a gap from the absence of an answer. gapRationale quotes or paraphrases that not-found evidence; when potentialKnowledgeGap is false, gapRationale is "" or null. It is a flag for human review, not a verdict.
6. unansweredDemand = true when at least one question in the intent got no usable answer content: answerStatus AGENT_UNAVAILABLE, NO_RESPONSE or REDACTED. It means "users asked, and the captured interaction gave no usable answer" — a demand signal, never a claim that the knowledge is missing. Both flags can be true in the same intent (not-found evidence and unanswered questions together).
7. answerStatus TRUNCATED means only that the transcript export cut the reply off at about 500 characters. It sets neither flag: it is not a sign of a wrong answer, missing knowledge or unanswered demand. Use the visible part as context; never guess or reconstruct the missing part.
8. confidence is how sure you are that the grouped questions share one information need: ${CONFIDENCE_LEVELS.join(", ")}.
9. Copy packageId from the input unchanged.
10. Reply with ONE JSON object and nothing else — no prose, no Markdown fences — matching this schema:

${JSON.stringify(INTENT_RESPONSE_SCHEMA, null, 2)}

INPUT (${request.items.length} questions)

${JSON.stringify(payload, null, 2)}
`;
}
