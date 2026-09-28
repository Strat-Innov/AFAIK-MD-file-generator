/* ------------------------------------------------------------------ *
 * AI Question Consolidation — validating the reply.
 *
 * Nothing the model returns is used until it passes every check here,
 * and a reply is all-or-nothing: one bad QA ID rejects the whole import,
 * because a partially trusted grouping would silently lose or invent
 * questions.
 *
 * Checks:
 *  - it is one JSON object (a single surrounding ```json fence is
 *    tolerated and reported, nothing else is repaired);
 *  - it is not the prompt or the input package pasted back by mistake;
 *  - packageId matches the package the app generated;
 *  - every consolidated question has the required fields and types;
 *  - QA ID coverage: each eligible QA ID exactly once — none missing,
 *    duplicated, unknown, or taken from the conversational records.
 *
 * The model's text (clean question, notes) is kept as written. Original
 * questions and answers are never copied into a consolidated question;
 * they are looked up from Layer 2 by QA ID, so they cannot drift.
 * ------------------------------------------------------------------ */

import { ANSWER_EVALUATION, PROMPT_MARKER } from "./questionPackage.js";

const QUESTION_FIELDS = ["questionId", "cleanQuestion", "qaIds", "answerEvaluation", "notes"];
const EVALUATIONS = Object.values(ANSWER_EVALUATION);
// Replies that contain no answer content at all.
const NO_REPLY_STATUSES = new Set(["AGENT_UNAVAILABLE", "NO_RESPONSE"]);

const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

function parseJson(text) {
  let body = String(text ?? "").trim();
  const warnings = [];
  const fence = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(body);
  if (fence) {
    body = fence[1].trim();
    warnings.push("The reply was wrapped in a Markdown code fence; the fence was removed.");
  }
  if (body === "") return { error: "The reply is empty.", warnings };
  try {
    return { value: JSON.parse(body), warnings };
  } catch (e) {
    return { error: `The reply is not valid JSON: ${e.message}`, warnings };
  }
}

/**
 * @param text     the model's reply, as pasted
 * @param request  the request from buildQuestionRequest() it answers
 * @returns {{ ok, errors, warnings, coverage, questions }}
 *   coverage:  { evaluated, expected, assigned, missing[], duplicated[], unknown[], conversational[] }
 *   questions: validated consolidated questions (only when ok)
 */
export function validateQuestionReply(text, request) {
  const expectedIds = request.items.map((i) => i.qaId);
  // `evaluated` stays false when the reply could not be read far enough
  // to count QA IDs, so "0 missing" is never shown for an unread reply.
  const coverage = { evaluated: false, expected: expectedIds.length, assigned: 0, missing: [], duplicated: [], unknown: [], conversational: [] };
  const fail = (errors, warnings = []) => ({ ok: false, errors, warnings, coverage, questions: [] });

  // The easiest mistake in a copy-and-paste round-trip: pasting the
  // prompt (or its input block) back instead of Claude's answer.
  const pasted = String(text ?? "");
  if (pasted.includes(PROMPT_MARKER) || (/"questions"\s*:\s*\[\s*\{\s*"qaId"/.test(pasted) && !pasted.includes('"cleanQuestion"'))) {
    return fail(["This is the prompt, not Claude's reply. Paste the prompt into Claude, then paste the JSON Claude answers with here — it has a \"questions\" list with \"cleanQuestion\" entries."]);
  }

  const { value, error, warnings } = parseJson(text);
  if (error) return fail([error], warnings);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(["The reply must be one JSON object with a \"questions\" array."], warnings);
  if (Array.isArray(value.items) && value.questions === undefined) {
    return fail(["This is the input package file, not Claude's reply. Send the prompt to Claude and paste the JSON Claude answers with here."], warnings);
  }

  const errors = [];
  if (value.packageId !== request.packageId) {
    errors.push(value.packageId === undefined
      ? `The reply has no packageId (expected ${request.packageId}).`
      : `The reply answers package ${JSON.stringify(value.packageId)}, but the current package is ${request.packageId}. Regenerate the prompt and ask again.`);
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    return fail([...errors, "The reply has no \"questions\" array, or it is empty."], warnings);
  }
  for (const k of Object.keys(value)) {
    if (!["packageId", "questions", "packageVersion"].includes(k)) warnings.push(`Ignored unexpected top-level field "${k}".`);
  }

  const seen = new Set();
  value.questions.forEach((q, n) => {
    const at = `Question #${n + 1}${nonEmptyString(q?.questionId) ? ` (${q.questionId})` : ""}`;
    if (q === null || typeof q !== "object" || Array.isArray(q)) { errors.push(`${at} is not an object.`); return; }
    if (!nonEmptyString(q.questionId)) errors.push(`${at}: questionId is missing.`);
    else if (seen.has(q.questionId)) errors.push(`${at}: questionId is used more than once.`);
    else seen.add(q.questionId);
    if (!nonEmptyString(q.cleanQuestion)) errors.push(`${at}: cleanQuestion is missing.`);
    if (!Array.isArray(q.qaIds) || q.qaIds.length === 0) errors.push(`${at}: qaIds must be a non-empty list.`);
    else if (q.qaIds.some((id) => typeof id !== "string")) errors.push(`${at}: every qaId must be a string.`);
    if (!EVALUATIONS.includes(q.answerEvaluation)) errors.push(`${at}: answerEvaluation must be one of ${EVALUATIONS.join(", ")}.`);
    if (q.notes !== undefined && q.notes !== null && typeof q.notes !== "string") errors.push(`${at}: notes must be text.`);
    const extra = Object.keys(q).filter((k) => !QUESTION_FIELDS.includes(k));
    if (extra.length) warnings.push(`${at}: ignored unexpected field(s) ${extra.map((k) => `"${k}"`).join(", ")}.`);
  });

  // Coverage — counted over every qaId string the reply contains.
  const expected = new Set(expectedIds);
  const conversational = new Set(request.excluded.map((x) => x.qaId));
  const counts = new Map();
  for (const q of value.questions) {
    if (!Array.isArray(q?.qaIds)) continue;
    for (const id of q.qaIds) if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (conversational.has(id)) coverage.conversational.push(id);
    else if (!expected.has(id)) coverage.unknown.push(id);
    if (n > 1) coverage.duplicated.push(id);
  }
  coverage.evaluated = true;
  coverage.missing = expectedIds.filter((id) => !counts.has(id));
  coverage.assigned = expectedIds.filter((id) => counts.has(id)).length;
  const order = (a, b) => a.localeCompare(b);
  coverage.duplicated.sort(order); coverage.unknown.sort(order); coverage.conversational.sort(order);

  if (coverage.missing.length) errors.push(`${coverage.missing.length} QA ID(s) missing: ${coverage.missing.join(", ")}.`);
  if (coverage.duplicated.length) errors.push(`${coverage.duplicated.length} QA ID(s) assigned more than once: ${coverage.duplicated.join(", ")}.`);
  if (coverage.unknown.length) errors.push(`${coverage.unknown.length} unknown QA ID(s), not in the package: ${coverage.unknown.join(", ")}.`);
  if (coverage.conversational.length) errors.push(`${coverage.conversational.length} conversational QA ID(s) that were not sent: ${coverage.conversational.join(", ")}.`);

  if (errors.length) return fail(errors, warnings);

  // One sanity check the app can make itself: a group whose every
  // question got no reply at all cannot have been answered.
  const itemsById = new Map(request.items.map((i) => [i.qaId, i]));
  for (const q of value.questions) {
    const noReply = q.qaIds.every((id) => NO_REPLY_STATUSES.has(itemsById.get(id).answerStatus));
    if (noReply && (q.answerEvaluation === ANSWER_EVALUATION.ANSWERED || q.answerEvaluation === ANSWER_EVALUATION.PARTIALLY_ANSWERED)) {
      warnings.push(`${q.questionId}: evaluated ${q.answerEvaluation}, but none of its questions got a reply (agent unavailable or no response).`);
    }
  }

  const questions = value.questions.map((q) => Object.freeze({
    questionId: q.questionId.trim(),
    cleanQuestion: q.cleanQuestion.trim(),
    qaIds: Object.freeze([...q.qaIds]),
    answerEvaluation: q.answerEvaluation,
    notes: (q.notes ?? "").trim(),
  }));
  return { ok: true, errors: [], warnings, coverage, questions };
}
