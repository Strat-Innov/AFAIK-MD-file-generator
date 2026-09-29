/* ------------------------------------------------------------------ *
 * Question consolidation.
 *
 * Information questions whose wording is identical apart from case,
 * spacing and punctuation become one clean question, with every
 * original QA ID kept. Reworded questions stay apart.
 *
 * Answer status is derived here from the transcript. It says what the
 * interaction shows, never whether an answer was factually right.
 *
 * Derived, never stored: recomputed from the Extracted Q&A records. The
 * original questions are never changed — they are looked up by QA ID
 * wherever they are shown.
 * ------------------------------------------------------------------ */

import { QUESTION_KIND, ANSWER_STATUS, PART_KIND } from "./qa.js";

export const ANSWER_EVALUATION = Object.freeze({
  ANSWERED: "ANSWERED",
  PARTIALLY_ANSWERED: "PARTIALLY_ANSWERED",
  NOT_ANSWERED: "NOT_ANSWERED",
  CANNOT_DETERMINE: "CANNOT_DETERMINE",
});

export const EXACT_MATCH_RULE = "Questions merged when their wording is identical apart from case, spacing and punctuation.";

/** The grouping key: lower case, punctuation and extra spacing removed. */
export const normalizeQuestion = (q) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/* A presentable version of the original wording — nothing reworded,
 * nothing added: spacing tidied, first letter capitalised, and a
 * question mark when the question has no closing punctuation. */
export function cleanQuestionText(q) {
  let t = q.replace(/\s+/g, " ").trim();
  if (!t) return t;
  t = t[0].toUpperCase() + t.slice(1);
  if (!/[?.!]$/.test(t)) t += "?";
  return t;
}

// An explicit "I could not find this" from the agent — seen in the
// September 2026 exports. Counts as not answered.
const NOT_FOUND = [
  /\bunable to find\b/i,
  /\bcould(?:n['’]t| not) find\b/i,
  /\bnot available in (?:the|my|our)?\s*(?:configured )?knowledge/i,
  /\binformation (?:is )?not (?:available|found)\b/i,
  /\b(?:do not|don['’]t) have (?:any )?(?:specific )?information\b/i,
];

/* One Q&A record's outcome, from the transcript only.
 * TRUNCATED is an export limit, not "not answered": the full reply is not
 * visible, so the result cannot be determined from the transcript. */
export function evaluateRecord(r) {
  const text = r.answerParts.filter((p) => p.kind === PART_KIND.NORMAL || p.kind === PART_KIND.TRUNCATED).map((p) => p.text).join("\n");
  switch (r.answerStatus) {
    case ANSWER_STATUS.AGENT_UNAVAILABLE:
    case ANSWER_STATUS.NO_RESPONSE:
      return { evaluation: ANSWER_EVALUATION.NOT_ANSWERED, reason: r.answerStatus === ANSWER_STATUS.NO_RESPONSE ? "no reply" : "agent unavailable" };
    case ANSWER_STATUS.REDACTED:
      return { evaluation: ANSWER_EVALUATION.CANNOT_DETERMINE, reason: "reply redacted in the export" };
    default:
      if (NOT_FOUND.some((re) => re.test(text))) return { evaluation: ANSWER_EVALUATION.NOT_ANSWERED, reason: "agent said the information was not found" };
      if (r.answerStatus === ANSWER_STATUS.TRUNCATED) return { evaluation: ANSWER_EVALUATION.CANNOT_DETERMINE, reason: "reply cut off by the export" };
      return { evaluation: ANSWER_EVALUATION.ANSWERED, reason: "answered" };
  }
}

/* A question asked several times: did users get the answer? Any
 * answered attempt → ANSWERED; else anything undeterminable →
 * CANNOT_DETERMINE; else NOT_ANSWERED. The notes say what each attempt
 * got, so the combined result is never opaque. */
export function answerStatusOf(members) {
  const outcomes = members.map(evaluateRecord);
  const has = (e) => outcomes.some((o) => o.evaluation === e);
  const answerEvaluation = has(ANSWER_EVALUATION.ANSWERED) ? ANSWER_EVALUATION.ANSWERED
    : has(ANSWER_EVALUATION.CANNOT_DETERMINE) ? ANSWER_EVALUATION.CANNOT_DETERMINE
    : ANSWER_EVALUATION.NOT_ANSWERED;
  let notes;
  if (outcomes.length === 1) notes = answerEvaluation === ANSWER_EVALUATION.ANSWERED ? "" : `Reply: ${outcomes[0].reason}.`;
  else {
    const tally = new Map();
    for (const o of outcomes) tally.set(o.reason, (tally.get(o.reason) ?? 0) + 1);
    notes = `Asked ${outcomes.length} times: ${[...tally].map(([reason, n]) => `${n} ${reason}`).join(", ")}.`;
  }
  return { answerEvaluation, notes };
}

/**
 * Consolidates the information questions by exact match.
 * @returns [{ questionId, cleanQuestion, qaIds, answerEvaluation, notes }] in order of first appearance
 */
export function consolidateQuestions(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.questionKind !== QUESTION_KIND.INFORMATION_REQUEST) continue;
    const key = normalizeQuestion(r.question);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
  }
  return [...groups.values()].map((members, i) => Object.freeze({
    questionId: `Q-${String(i + 1).padStart(3, "0")}`,
    cleanQuestion: cleanQuestionText(members[0].question),
    qaIds: Object.freeze(members.map((m) => m.id)),
    ...answerStatusOf(members),
  }));
}
