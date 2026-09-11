/* ------------------------------------------------------------------ *
 * QUESTION QUALITY — flag a generated question before it becomes a score.
 *
 * The September V1 audit found six questions that were defensible as
 * extractions but indefensible as ground truth, and every one of them
 * cost an arm marks it had not earned or lost:
 *
 *   q0202, q0584-q0587  Specification rows scraped under an amenities
 *                       heading, producing "Does THE GLADES have a Price
 *                       range: P7M - P13M?" A price range is not an
 *                       amenity, and the yes/no framing is unanswerable
 *                       as asked.
 *
 *   q0132               "what is the bloons popped?" with the source
 *                       value "Countless". The evaluator marked Arm C
 *                       down for vagueness; the source is the vague one.
 *
 * These are not model failures and not evaluator failures. They are
 * question failures, and they are visible at generation time from the
 * question and its own answer — no corpus lookup, no model, no judgement
 * about meaning.
 *
 * NOTHING HERE REWRITES A QUESTION. It emits warnings for review before
 * a set is frozen. Silently repairing generated data would destroy the
 * property that makes the set usable: that every question and answer
 * came verbatim from the page.
 * ------------------------------------------------------------------ */

/** Severities, in the same vocabulary the source-integrity check uses. */
const HIGH = "high";
const MEDIUM = "medium";
const LOW = "low";

// A value that reads as a specification row rather than a thing a
// property can "have": a label, a colon, and a measurement or money.
const SPEC_ROW = /^\s*(price|prices|pricing|price\s*range|price\/sqm|lot\s*sizes?|modal\s*lot\s*size|floor\s*area|unit\s*sizes?|turnover|no\.?\s*of\s*units|total\s*units)\b.*[:\-]/i;
const MEASUREMENT = /[₱$]|\bphp\b|\bsqm\b|\bsq\.?\s*m\b|\d\s*[-–]\s*\d/i;

// Questions whose form commits to an answer type.
const ASKS_NUMBER = /\bhow many\b|\bhow much\b|\bwhat is the (?:number|total|count|price|cost|area|size)\b/i;
const HAS_NUMBER = /\d/;

// Values that state the absence of a value.
const NON_ANSWER = /^\s*(countless|various|varies|n\/?a|tba|tbd|none|not applicable|to be announced|many|several|multiple)\s*[.!]?\s*$/i;

/**
 * Check one generated question against its own answer.
 *
 * `q` is a record from the question set: { id, page, kind, question,
 * answer, evidence }. Returns an array of findings, empty when the
 * question is sound.
 */
export function checkQuestion(q) {
  const findings = [];
  const question = String(q?.question ?? "");
  const answer = String(q?.answer ?? "");
  const evidence = String(q?.evidence ?? "");

  // 1. A specification row asked as an amenity yes/no.
  if (q?.kind === "amenity" && (SPEC_ROW.test(evidence) || (/[:]/.test(evidence) && MEASUREMENT.test(evidence)))) {
    findings.push({
      rule: "spec-row-as-amenity",
      severity: MEDIUM,
      detail:
        `"${evidence}" is a specification row, not an amenity. Asking whether the ` +
        `project "has" it is not answerable as posed.`,
      evidence: [question, answer],
    });
  }

  // 2. The question demands a quantity; the source supplies a word.
  const bare = answer.replace(/^yes\s*[—–-]\s*/i, "");
  if (ASKS_NUMBER.test(question) && !HAS_NUMBER.test(bare)) {
    findings.push({
      rule: "quantity-asked-nonnumeric-source",
      severity: NON_ANSWER.test(bare) ? MEDIUM : LOW,
      detail:
        `The question asks for a quantity but the source value is "${bare.trim()}". ` +
        `An evaluator will read the answer as vague when the page is.`,
      evidence: [question, answer],
    });
  }

  // 3. The source states that no value exists.
  if (NON_ANSWER.test(bare) && !ASKS_NUMBER.test(question)) {
    findings.push({
      rule: "source-value-is-a-non-answer",
      severity: LOW,
      detail: `The ground truth is "${bare.trim()}", which asserts no fact.`,
      evidence: [question, answer],
    });
  }

  // 4. Nothing to score against.
  if (!answer.trim()) {
    findings.push({
      rule: "empty-ground-truth",
      severity: HIGH,
      detail: "The question carries no expected answer and cannot be scored.",
      evidence: [question],
    });
  }

  return findings.map((f) => ({ ...f, id: q?.id ?? null, page: q?.page ?? null, kind: q?.kind ?? null }));
}

/**
 * Check a whole set, and additionally the properties that only exist
 * across questions: duplicate ids, and questions anchored on a page the
 * corpus no longer contains.
 */
export function checkQuestionSet(questions, { corpusPages } = {}) {
  const findings = questions.flatMap(checkQuestion);

  const seen = new Map();
  for (const q of questions) seen.set(q.id, (seen.get(q.id) ?? 0) + 1);
  for (const [id, n] of seen) {
    if (n > 1) {
      findings.push({
        rule: "duplicate-question-id",
        severity: HIGH,
        detail: `${id} appears ${n} times.`,
        id, page: null, kind: null, evidence: [],
      });
    }
  }

  if (corpusPages) {
    const present = new Set(corpusPages);
    for (const q of questions) {
      if (!present.has(q.page)) {
        findings.push({
          rule: "question-references-absent-page",
          severity: HIGH,
          detail: `${q.id} is anchored on ${q.page}, which is not in the corpus.`,
          id: q.id, page: q.page, kind: q.kind, evidence: [q.question],
        });
      }
    }
  }

  const rank = { high: 3, medium: 2, low: 1 };
  const severity = findings.length
    ? findings.reduce((a, f) => (rank[f.severity] > rank[a] ? f.severity : a), LOW)
    : null;
  return { findings, severity, counts: countBySeverity(findings) };
}

export function countBySeverity(findings) {
  const out = { high: 0, medium: 0, low: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

/** A high-severity question finding means the set is not fit to freeze. */
export const blocksFreeze = (report) => report.severity === HIGH;

export function formatQuestionReport(report) {
  if (!report.findings.length) return "question quality: no findings";
  const lines = [`question quality: ${report.findings.length} finding(s)`, `  ${JSON.stringify(report.counts)}`];
  for (const f of report.findings) {
    lines.push(`  [${f.severity}] ${f.id ?? "-"} ${f.rule}: ${f.detail}`);
  }
  return lines.join("\n");
}
