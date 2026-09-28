/* ------------------------------------------------------------------ *
 * Search, filter and sort over extracted Q&A records — read-only.
 * Same contract as sessionQuery.js: new arrays out, records untouched.
 * ------------------------------------------------------------------ */

import { PARSE_STATUS } from "./transcript.js";

export const DEFAULT_QA_FILTERS = Object.freeze({
  text: "",
  answerStatus: "", // one ANSWER_STATUS, or "" for all
  parseIssuesOnly: false,
  reviewOnly: false,
  sourceFile: "",
});

export function filterQA(records, filters = DEFAULT_QA_FILTERS) {
  const f = { ...DEFAULT_QA_FILTERS, ...filters };
  const needle = f.text.trim().toLowerCase();
  return records.filter((r) => {
    if (f.answerStatus && r.answerStatus !== f.answerStatus) return false;
    if (f.parseIssuesOnly && r.parseStatus === PARSE_STATUS.OK) return false;
    if (f.reviewOnly && !r.requiresReview) return false;
    if (f.sourceFile && !r.sourceFiles.includes(f.sourceFile)) return false;
    if (needle) {
      const haystack = [r.id, r.sessionId, r.question, ...r.answerParts.map((p) => p.text)].join("\n").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

const SORTS = {
  // Extraction order: session order, then question order.
  id: (r) => r.id,
  timestamp: (r) => `${r.timestamp ?? ""}#${String(r.turnNumber).padStart(4, "0")}`,
  answerStatus: (r) => r.answerStatus,
  question: (r) => r.question.trim().toLowerCase(),
};

/** Stable; ties keep extraction order. */
export function sortQA(records, key = "id", direction = "asc") {
  const read = SORTS[key];
  if (!read) throw new Error(`Unknown sort key "${key}".`);
  const sign = direction === "asc" ? 1 : -1;
  return records
    .map((r, i) => ({ r, i, v: read(r) }))
    .sort((a, b) => (a.v === b.v ? a.i - b.i : (a.v < b.v ? -1 : 1) * sign))
    .map((x) => x.r);
}
