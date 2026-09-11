/* ------------------------------------------------------------------ *
 * EVALUATION RESULTS — raw evaluator output, normalised but never lost.
 *
 * The September V1 audit turned on distinctions a two-state model
 * destroys. Arm C row q0197 came back with an EMPTY verdict and an empty
 * response: the evaluator never judged it. Folding that into Fail would
 * have reported a retrieval failure that did not happen; folding it into
 * Pass would have invented a result. Seven Arm A rows failed because the
 * platform errored ("response is too large to handle", "Responsible AI
 * restrictions"), not because retrieval failed. One Arm A row came back
 * Error while its answer contained the expected email verbatim.
 *
 * So: every row keeps its `raw` string exactly as the evaluator wrote
 * it, and normalisation only ever ADDS a coarse bucket next to it.
 * Nothing here maps one bucket onto another.
 *
 * Adjudication is a SEPARATE layer (see `adjudicate`). A human or audit
 * conclusion is recorded beside the raw result, never on top of it, so
 * both numbers can always be reported.
 * ------------------------------------------------------------------ */

/** The four buckets. OTHER is a real outcome, not a parse failure. */
export const PASS = "PASS";
export const FAIL = "FAIL";
export const ERROR = "ERROR";
export const OTHER = "OTHER";

export const RESULT_KINDS = [PASS, FAIL, ERROR, OTHER];

// Evaluator spellings seen in practice. Anything not listed — including
// the empty string — normalises to OTHER rather than being guessed at.
const KNOWN = new Map([
  ["pass", PASS],
  ["passed", PASS],
  ["fail", FAIL],
  ["failed", FAIL],
  ["error", ERROR],
]);

/**
 * Normalise one evaluator verdict.
 *
 * Returns `{ raw, kind, recognised }`. `raw` is the untouched original,
 * `kind` one of the four buckets, and `recognised` false when the
 * evaluator said something this code has never seen — which is the
 * signal to look at the row, not to pick a side.
 */
export function normalizeResult(raw) {
  const text = raw == null ? "" : String(raw);
  const kind = KNOWN.get(text.trim().toLowerCase());
  return { raw: text, kind: kind ?? OTHER, recognised: kind !== undefined };
}

/**
 * Why did this row not produce a verdict? Distinguishes the cases the
 * audit had to separate by hand: an evaluator that errored, a platform
 * that errored, and an evaluation that never completed.
 *
 * Platform failures are identified from the AGENT's response text, not
 * from the verdict, because the evaluator scores them as ordinary Fails.
 */
const PLATFORM = /response that is too large to handle|Error code:\s*\w+|SystemError|Responsible AI restrictions|Sorry, something went wrong/i;

export function classifyRow({ result, actualResponse, explanation } = {}) {
  const { raw, kind, recognised } = normalizeResult(result);
  const answer = actualResponse == null ? "" : String(actualResponse);
  const why =
    kind === ERROR ? "evaluator-error"
    : !recognised && !answer.trim() ? "incomplete-evaluation"
    : !recognised ? "unrecognised-verdict"
    : PLATFORM.test(answer) ? "platform-error"
    : "evaluated";
  return {
    raw,
    kind,
    recognised,
    disposition: why,
    // An empty verdict AND an empty answer means nothing ran. That is
    // materially different from a model that answered and was judged.
    complete: recognised && why !== "incomplete-evaluation",
    explanation: explanation == null ? "" : String(explanation),
  };
}

/**
 * Attach an adjudication to a raw row without touching it.
 *
 * `classification` is the audit category (the September V1 audit used
 * TRUE_FAIL, EVALUATOR_ERROR, ENTITY_MISMATCH, and so on); `outcome` is
 * the bucket the adjudicator believes is correct. Both the raw and the
 * adjudicated bucket survive, which is what lets a report show "raw
 * Pass, adjudicated FAIL" for a confidently wrong answer.
 */
export function adjudicate(row, { classification, outcome, evidence, reason } = {}) {
  if (outcome && !RESULT_KINDS.includes(outcome)) {
    throw new Error(`adjudicated outcome must be one of ${RESULT_KINDS.join(", ")}, got ${outcome}`);
  }
  return {
    ...row,
    adjudication: {
      classification: classification ?? null,
      outcome: outcome ?? null,
      evidence: evidence ?? null,
      reason: reason ?? null,
      // true when the audit disagrees with the evaluator
      changed: Boolean(outcome) && outcome !== row.kind,
    },
  };
}

/**
 * Tally a set of rows in both layers at once. The raw counts are what
 * gets published as the official result; the adjudicated counts are
 * reported alongside, never instead.
 */
export function tally(rows) {
  const raw = Object.fromEntries(RESULT_KINDS.map((k) => [k, 0]));
  const adjudicated = Object.fromEntries(RESULT_KINDS.map((k) => [k, 0]));
  let changed = 0;
  for (const r of rows) {
    raw[r.kind] += 1;
    const out = r.adjudication?.outcome ?? r.kind;
    adjudicated[out] += 1;
    if (r.adjudication?.changed) changed += 1;
  }
  const n = rows.length;
  return {
    n,
    raw,
    adjudicated,
    changed,
    // Pass rate is over ALL rows, so an unevaluated row lowers it rather
    // than quietly leaving the denominator.
    rawPassRate: n ? raw[PASS] / n : 0,
    adjudicatedPassRate: n ? adjudicated[PASS] / n : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Evaluation methods. The September V1 run used exactly one — Copilot's
 * "General quality" — which scores answered / on-topic / grounded and
 * never compares the answer to `expectedResponse`. That is why 8 Arm B
 * and 2 Arm C rows passed with the wrong person or the wrong URL.
 *
 * The fix is not to drop General Quality but to stop the data model
 * assuming it is the only one. A row carries results PER METHOD.
 * ------------------------------------------------------------------ */

export const METHODS = {
  general_quality: {
    id: "general_quality",
    label: "General quality",
    checks: "answered, on-topic, grounded in the configured sources",
    comparesToExpected: false,
  },
  answer_correctness: {
    id: "answer_correctness",
    label: "Answer correctness",
    checks: "actualResponse contains/entails expectedResponse",
    comparesToExpected: true,
  },
  url_correctness: {
    id: "url_correctness",
    label: "URL correctness",
    checks: "the expected destination URL is returned intact and usable",
    comparesToExpected: true,
  },
  entity_grounding: {
    id: "entity_grounding",
    label: "Entity grounding",
    checks: "the answer is attributable to the entity the question named",
    comparesToExpected: false,
  },
};

/** Evaluator spellings map onto method ids; unknown ones are kept as-is. */
export const methodId = (label) =>
  String(label ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_") || "unknown";

/**
 * One question's results across however many methods were run.
 * `byMethod` is keyed by method id; absent methods are simply absent
 * rather than defaulted, so "not measured" never reads as "failed".
 */
export function evaluationRecord({ qid, question, expectedResponse, actualResponse, byMethod = {} }) {
  return { qid, question, expectedResponse, actualResponse, byMethod };
}
