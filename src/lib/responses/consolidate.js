/* ------------------------------------------------------------------ *
 * Question consolidation — built in, deterministic, no AI.
 *
 * Merges information questions whose wording is identical apart from
 * case, spacing and punctuation, and derives each clean question's
 * answer result from what the transcript shows. Reworded questions stay
 * separate: telling "South Station 1BR price?" and "How much is a 1-BR
 * unit at South Station?" apart as the same question needs judgement
 * this module deliberately does not attempt.
 *
 * The output has the same shape the workbook export and the view use:
 *   { questionId, cleanQuestion, qaIds, answerEvaluation, notes }
 *
 * Derived, never stored: recomputed from the Extracted Q&A records, so it
 * cannot drift from them. The original questions are never changed —
 * they are looked up by QA ID wherever they are shown.
 * ------------------------------------------------------------------ */

import { QUESTION_KIND, ANSWER_STATUS, PART_KIND } from "./qa.js";

export const ANSWER_EVALUATION = Object.freeze({
  ANSWERED: "ANSWERED",
  PARTIALLY_ANSWERED: "PARTIALLY_ANSWERED",
  NOT_ANSWERED: "NOT_ANSWERED",
  CANNOT_DETERMINE: "CANNOT_DETERMINE",
});

export const CONSOLIDATION_METHOD =
  "Automatic: questions merged when their wording is identical apart from case, spacing and punctuation.";

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
function combine(outcomes) {
  const has = (e) => outcomes.some((o) => o.evaluation === e);
  if (has(ANSWER_EVALUATION.ANSWERED)) return ANSWER_EVALUATION.ANSWERED;
  if (has(ANSWER_EVALUATION.CANNOT_DETERMINE)) return ANSWER_EVALUATION.CANNOT_DETERMINE;
  return ANSWER_EVALUATION.NOT_ANSWERED;
}

function notesFor(outcomes) {
  if (outcomes.length === 1) return outcomes[0].evaluation === ANSWER_EVALUATION.ANSWERED ? "" : `Reply: ${outcomes[0].reason}.`;
  const tally = new Map();
  for (const o of outcomes) tally.set(o.reason, (tally.get(o.reason) ?? 0) + 1);
  return `Asked ${outcomes.length} times: ${[...tally].map(([reason, n]) => `${n} ${reason}`).join(", ")}.`;
}

/**
 * @param records  Extracted Q&A records
 * @returns consolidated questions, in order of first appearance
 */
export function consolidateQuestions(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.questionKind !== QUESTION_KIND.INFORMATION_REQUEST) continue;
    const key = normalizeQuestion(r.question);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
  }
  return [...groups.values()].map((members, i) => {
    const outcomes = members.map(evaluateRecord);
    return Object.freeze({
      questionId: `CQ-${String(i + 1).padStart(3, "0")}`,
      cleanQuestion: cleanQuestionText(members[0].question),
      qaIds: Object.freeze(members.map((m) => m.id)),
      answerEvaluation: combine(outcomes),
      notes: notesFor(outcomes),
    });
  });
}
