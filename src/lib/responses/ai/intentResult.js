/* ------------------------------------------------------------------ *
 * AI Intent Consolidation — validating the reply.
 *
 * Nothing the model returns is used until it passes every check here.
 * A reply is all-or-nothing: one bad QA ID rejects the whole import,
 * because a partially trusted grouping would silently lose or invent
 * questions — exactly what the traceability chain exists to prevent.
 *
 * Checks:
 *  - it is one JSON object (a single surrounding ```json fence is
 *    tolerated and reported, nothing else is repaired);
 *  - packageId matches the package the app generated, so a reply to an
 *    older or different question set cannot be imported by mistake;
 *  - every intent has the required fields with the required types;
 *  - QA ID coverage against the package: each of the expected IDs
 *    exactly once across all intents — none missing, duplicated,
 *    unknown, or taken from the conversational records left out.
 *
 * The model's text (titles, needs, rationales) is kept as it wrote it.
 * The app adds review state and the links back to the source; it never
 * copies question or answer text into a candidate — those are looked up
 * from Layer 2 by QA ID, so they cannot drift from the source.
 * ------------------------------------------------------------------ */

import { CONFIDENCE_LEVELS, PROMPT_MARKER } from "./intentPackage.js";

export const REVIEW_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
});

const INTENT_FIELDS = ["intentId", "intentTitle", "informationNeed", "qaIds", "potentialKnowledgeGap", "gapRationale", "confidence", "notes"];

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
 * @param request  the request from buildIntentRequest() it answers
 * @returns {{ ok, errors, warnings, coverage, intents }}
 *   coverage: { expected, assigned, missing[], duplicated[], unknown[], conversational[] }
 *   intents:  validated candidates (only when ok), reviewStatus PENDING
 */
export function validateIntentReply(text, request) {
  const expectedIds = request.items.map((i) => i.qaId);
  // `evaluated` stays false when the reply could not be read far enough
  // to count QA IDs, so "0 missing" is never shown for an unread reply.
  const coverage = { evaluated: false, expected: expectedIds.length, assigned: 0, missing: [], duplicated: [], unknown: [], conversational: [] };
  const fail = (errors, warnings = []) => ({ ok: false, errors, warnings, coverage, intents: [] });

  // The easiest mistake in a copy-and-paste round-trip: pasting the
  // prompt (or its input block) back instead of Claude's answer.
  const pasted = String(text ?? "");
  if (pasted.includes(PROMPT_MARKER) || (pasted.includes('"questions"') && !pasted.includes('"intents"'))) {
    return fail(["This is the prompt, not Claude's reply. Paste the prompt into Claude, then paste the JSON that Claude answers with here — it starts with {\"packageId\": … \"intents\": …."]);
  }

  const { value, error, warnings } = parseJson(text);
  if (error) return fail([error], warnings);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(["The reply must be one JSON object with an \"intents\" array."], warnings);

  const errors = [];
  if (value.packageId !== request.packageId) {
    errors.push(value.packageId === undefined
      ? `The reply has no packageId (expected ${request.packageId}).`
      : `The reply answers package ${JSON.stringify(value.packageId)}, but the current package is ${request.packageId}. Regenerate the prompt and ask again.`);
  }
  if (!Array.isArray(value.intents) || value.intents.length === 0) {
    return fail([...errors, "The reply has no \"intents\" array, or it is empty."], warnings);
  }
  for (const k of Object.keys(value)) {
    if (!["packageId", "intents", "packageVersion"].includes(k)) warnings.push(`Ignored unexpected top-level field "${k}".`);
  }

  const seenIntentIds = new Set();
  value.intents.forEach((it, n) => {
    const at = `Intent #${n + 1}${nonEmptyString(it?.intentId) ? ` (${it.intentId})` : ""}`;
    if (it === null || typeof it !== "object" || Array.isArray(it)) { errors.push(`${at} is not an object.`); return; }
    if (!nonEmptyString(it.intentId)) errors.push(`${at}: intentId is missing.`);
    else if (seenIntentIds.has(it.intentId)) errors.push(`${at}: intentId is used more than once.`);
    else seenIntentIds.add(it.intentId);
    if (!nonEmptyString(it.intentTitle)) errors.push(`${at}: intentTitle is missing.`);
    if (!nonEmptyString(it.informationNeed)) errors.push(`${at}: informationNeed is missing.`);
    if (!Array.isArray(it.qaIds) || it.qaIds.length === 0) errors.push(`${at}: qaIds must be a non-empty list.`);
    else if (it.qaIds.some((q) => typeof q !== "string")) errors.push(`${at}: every qaId must be a string.`);
    if (typeof it.potentialKnowledgeGap !== "boolean") errors.push(`${at}: potentialKnowledgeGap must be true or false.`);
    else if (it.potentialKnowledgeGap && !nonEmptyString(it.gapRationale)) errors.push(`${at}: a potential knowledge gap needs a gapRationale.`);
    if (it.gapRationale !== undefined && typeof it.gapRationale !== "string") errors.push(`${at}: gapRationale must be text.`);
    if (!CONFIDENCE_LEVELS.includes(String(it.confidence ?? "").toLowerCase())) errors.push(`${at}: confidence must be one of ${CONFIDENCE_LEVELS.join(", ")}.`);
    if (it.notes !== undefined && it.notes !== null && typeof it.notes !== "string") errors.push(`${at}: notes must be text.`);
    const extra = Object.keys(it).filter((k) => !INTENT_FIELDS.includes(k));
    if (extra.length) warnings.push(`${at}: ignored unexpected field(s) ${extra.map((k) => `"${k}"`).join(", ")}.`);
  });

  // Coverage — counted over every qaId string the reply contains.
  const expected = new Set(expectedIds);
  const conversational = new Set(request.excluded.map((x) => x.qaId));
  const counts = new Map();
  for (const it of value.intents) {
    if (!Array.isArray(it?.qaIds)) continue;
    for (const q of it.qaIds) if (typeof q === "string") counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  for (const [q, n] of counts) {
    if (conversational.has(q)) coverage.conversational.push(q);
    else if (!expected.has(q)) coverage.unknown.push(q);
    if (n > 1) coverage.duplicated.push(q);
  }
  coverage.evaluated = true;
  coverage.missing = expectedIds.filter((q) => !counts.has(q));
  coverage.assigned = expectedIds.filter((q) => counts.has(q)).length;
  const order = (a, b) => a.localeCompare(b);
  coverage.duplicated.sort(order); coverage.unknown.sort(order); coverage.conversational.sort(order);

  if (coverage.missing.length) errors.push(`${coverage.missing.length} QA ID(s) missing: ${coverage.missing.join(", ")}.`);
  if (coverage.duplicated.length) errors.push(`${coverage.duplicated.length} QA ID(s) assigned more than once: ${coverage.duplicated.join(", ")}.`);
  if (coverage.unknown.length) errors.push(`${coverage.unknown.length} unknown QA ID(s), not in the package: ${coverage.unknown.join(", ")}.`);
  if (coverage.conversational.length) errors.push(`${coverage.conversational.length} conversational QA ID(s) that were not sent: ${coverage.conversational.join(", ")}.`);

  if (errors.length) return fail(errors, warnings);

  const intents = value.intents.map((it) => Object.freeze({
    intentId: it.intentId.trim(),
    intentTitle: it.intentTitle.trim(),
    informationNeed: it.informationNeed.trim(),
    qaIds: Object.freeze([...it.qaIds]),
    potentialKnowledgeGap: it.potentialKnowledgeGap,
    gapRationale: (it.gapRationale ?? "").trim(),
    confidence: it.confidence.toLowerCase(),
    notes: (it.notes ?? "").trim(),
    reviewStatus: REVIEW_STATUS.PENDING,
  }));
  return { ok: true, errors: [], warnings, coverage, intents };
}
