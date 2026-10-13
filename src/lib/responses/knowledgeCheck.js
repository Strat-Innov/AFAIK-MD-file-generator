/* ------------------------------------------------------------------ *
 * Knowledge check — does the knowledge file actually carry an answer
 * to the questions users asked?
 *
 * The Answer status column says what the transcript shows: whether the
 * agent replied. That cannot say whether the knowledge base HELD the
 * answer, so "not answered" never says whose fault it was, and a reply
 * never proves the knowledge base was the source of it.
 *
 * Comparing each consolidated question against an uploaded knowledge
 * Markdown file separates the two causes, which need opposite fixes:
 *
 *   file has the content, user got no answer  ->  retrieval / agent
 *   file has nothing,     user got no answer  ->  content is missing
 *   file has nothing,     user got an answer  ->  worth a human look
 *
 * This is a LEXICAL check, not a semantic one, and it is deliberately
 * limited in what it claims. It reports how much of a question's
 * informative wording appears on the best-matching page, and names that
 * page and the words it did and did not find, so every verdict can be
 * checked by eye rather than trusted. It does not read, reason about or
 * confirm any answer's facts: nothing here says an answer is correct.
 * ------------------------------------------------------------------ */

import { ANSWER_EVALUATION } from "./consolidate.js";
import { parsePage } from "../aspxDocument.js";
import { renderOptimized } from "../optimizedMd.js";

export const KNOWLEDGE_VERDICT = Object.freeze({
  SUPPORTED: "SUPPORTED",
  RETRIEVAL_GAP: "RETRIEVAL_GAP",
  ANSWER_NOT_IN_KB: "ANSWER_NOT_IN_KB",
  KNOWLEDGE_GAP: "KNOWLEDGE_GAP",
  WEAK_MATCH: "WEAK_MATCH",
  CANNOT_CHECK: "CANNOT_CHECK",
});

/* How much of a question's informative wording has to appear on one
 * page before the page counts as carrying the answer.
 *
 * These are judgement calls, not measurements, which is why the score
 * and the matched words are reported alongside every verdict: a number
 * near a boundary is for a person to settle, not this file. */
export const COVERED_AT = 0.6;
export const WEAK_AT = 0.3;

export const KNOWLEDGE_CHECK_RULE =
  "Lexical comparison against the uploaded knowledge file: the share of a question's " +
  "informative words found on the best-matching page. It locates supporting content — " +
  "it does not verify that any answer is factually correct.";

/* Words that carry no retrieval signal. Question openers are included
 * because almost every question starts with one, so they would make
 * unrelated pages look like matches. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "have", "has", "had", "having", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "of", "in", "on", "at", "to", "for", "with", "by", "from", "into", "about",
  "as", "it", "its", "i", "me", "my", "we", "our", "us", "you", "your", "they", "them", "their",
  "he", "she", "his", "her", "there", "here", "what", "which", "who", "whom", "whose", "when",
  "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "too", "very", "just", "also",
  "please", "tell", "give", "show", "get", "need", "want", "know", "like", "kindly", "hi",
  "hello", "thanks", "thank",
]);

/** Informative words of a string: lower case, punctuation dropped, stopwords and single letters removed. */
export function terms(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
}

/* ---- reading a knowledge Markdown file ---- */

export const KNOWLEDGE_FORMAT = Object.freeze({ AI: "AI", MASTER: "MASTER", PLAIN: "PLAIN" });

/* Each page in an AI file ends with a Source section naming the file it
 * came from. That line is the generator's own structure, so it beats
 * splitting on "# " or "---": a page's own content can contain either,
 * and in real exports it does. */
const SOURCE_LINE = /^- Source file:\s*(.+?)\s*$/gm;

/* A Master file carries each page's untouched .aspx inside a fence. The
 * raw bytes are full of GUIDs, JSON and base64 that would match
 * anything, so the page is run through the app's own extractor and the
 * retrieval text is indexed instead of the source. */
const MASTER_BLOCK = /(?:^|\n)## (.+?)\n(?:[^\n]*\n)*?```aspx\n([\s\S]*?)\n```/g;

export function detectFormat(text) {
  if (text.includes("```aspx")) return KNOWLEDGE_FORMAT.MASTER;
  SOURCE_LINE.lastIndex = 0;
  if (SOURCE_LINE.test(text)) return KNOWLEDGE_FORMAT.AI;
  return KNOWLEDGE_FORMAT.PLAIN;
}

function aiPages(text) {
  const pages = [];
  let from = 0;
  SOURCE_LINE.lastIndex = 0;
  for (let m = SOURCE_LINE.exec(text); m; m = SOURCE_LINE.exec(text)) {
    const end = m.index + m[0].length;
    pages.push({ name: m[1], text: text.slice(from, end) });
    from = end;
  }
  return pages;
}

function masterPages(text) {
  const pages = [];
  MASTER_BLOCK.lastIndex = 0;
  for (let m = MASTER_BLOCK.exec(text); m; m = MASTER_BLOCK.exec(text)) {
    const name = m[1].trim();
    /* A page that yields no content sections contributes no text. Its
     * rendered form would still carry the filename and the source
     * metadata, so indexing that would let an author's email address
     * match a question. It is indexed as empty and reported instead,
     * because a page that cannot be searched must not look like one
     * that was searched and found wanting. */
    try {
      const page = parsePage(m[2], { name, path: name });
      const noText = page.sections.length === 0;
      pages.push({ name, text: noText ? "" : renderOptimized(page), noText });
    } catch {
      pages.push({ name, text: "", noText: true });
    }
  }
  return pages;
}

/* A file that is neither: split on top-level headings so an ordinary
 * knowledge document is still usable. */
function plainPages(text) {
  const parts = text.split(/\n(?=# )/);
  return parts
    .map((p, i) => ({ name: (p.match(/^# (.+)$/m)?.[1] ?? `Section ${i + 1}`).trim(), text: p }))
    .filter((p) => p.text.trim());
}

/**
 * Reads one knowledge Markdown file into pages.
 * @returns { format, pages: [{ name, text, noText? }] }
 */
export function parseKnowledgeMd(text) {
  const format = detectFormat(text ?? "");
  const pages =
    format === KNOWLEDGE_FORMAT.MASTER ? masterPages(text)
    : format === KNOWLEDGE_FORMAT.AI ? aiPages(text)
    : plainPages(text);
  return { format, pages };
}

/* ---- the index ---- */

/**
 * Builds the searchable index over one or more knowledge files.
 * @param files [{ name, text }] uploaded files
 * @returns { pages, formats, noText, idf, sources }
 */
export function indexKnowledge(files) {
  const pages = [];
  const formats = new Set();
  const sources = [];
  for (const f of files) {
    const { format, pages: ps } = parseKnowledgeMd(f.text);
    formats.add(format);
    sources.push({ file: f.name, format, pages: ps.length });
    for (const p of ps) {
      const termCount = new Map();
      for (const t of terms(p.text)) termCount.set(t, (termCount.get(t) ?? 0) + 1);
      pages.push({ ...p, file: f.name, termCount, nameTerms: new Set(terms(p.name)) });
    }
  }

  // Inverse document frequency: a word on every page tells you nothing,
  // a word on one page tells you which page.
  const df = new Map();
  for (const p of pages) for (const t of p.termCount.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = pages.length;
  const idf = (t) => Math.log(1 + n / ((df.get(t) ?? 0) + 1));

  return {
    pages,
    sources,
    formats: [...formats],
    noText: pages.filter((p) => p.noText).map((p) => p.name),
    idf,
    pageCount: n,
  };
}

/* The share of a question's informative words that appear on a page,
 * weighted so a rare word counts for more than a common one. Returns
 * the matched and missing words so the score can be read, not trusted. */
export function scorePage(qTerms, page, idf) {
  let total = 0;
  let got = 0;
  let occurrences = 0;
  let nameHits = 0;
  const matched = [];
  const missing = [];
  for (const t of qTerms) {
    const w = idf(t);
    total += w;
    const n = page.termCount.get(t) ?? 0;
    if (n > 0) {
      got += w;
      occurrences += n;
      if (page.nameTerms.has(t)) nameHits += 1;
      matched.push(t);
    } else {
      missing.push(t);
    }
  }
  return { score: total ? got / total : 0, matched, missing, occurrences, nameHits };
}

/* The highest-scoring page, and when several score the same the one the
 * evidence should actually point at.
 *
 * Ties are common and not a curiosity: ask about a form and every page
 * mentioning that form scores 1.0. Reporting whichever came first in
 * the file would name a page the reader can see is not the subject, and
 * a verdict whose evidence looks wrong is worse than no verdict. So a
 * tie goes to the page whose own TITLE carries the question's words,
 * then to the page that says them most often. The reported score stays
 * the plain term-coverage ratio — the tie-break orders pages, it never
 * inflates the number shown. */
export function bestPage(qTerms, index) {
  let best = null;
  for (const page of index.pages) {
    const r = scorePage(qTerms, page, index.idf);
    const better =
      !best ||
      r.score > best.score ||
      (r.score === best.score && r.nameHits > best.nameHits) ||
      (r.score === best.score && r.nameHits === best.nameHits && r.occurrences > best.occurrences);
    if (better) best = { ...r, page };
  }
  return best;
}

/* ---- the verdict ---- */

function verdictOf(score, answerEvaluation, checkable) {
  if (!checkable) return KNOWLEDGE_VERDICT.CANNOT_CHECK;
  if (answerEvaluation === ANSWER_EVALUATION.CANNOT_DETERMINE) return KNOWLEDGE_VERDICT.CANNOT_CHECK;
  const answered = answerEvaluation === ANSWER_EVALUATION.ANSWERED;
  if (score >= COVERED_AT) return answered ? KNOWLEDGE_VERDICT.SUPPORTED : KNOWLEDGE_VERDICT.RETRIEVAL_GAP;
  if (score >= WEAK_AT) return KNOWLEDGE_VERDICT.WEAK_MATCH;
  return answered ? KNOWLEDGE_VERDICT.ANSWER_NOT_IN_KB : KNOWLEDGE_VERDICT.KNOWLEDGE_GAP;
}

/**
 * Checks one consolidated question against the index.
 * @returns { questionId, verdict, score, page, matched, missing, answerScore }
 */
export function checkQuestion(question, index, { answerText = "" } = {}) {
  const qTerms = [...new Set(terms(question.cleanQuestion))];
  const checkable = qTerms.length > 0 && index.pageCount > 0;
  const best = checkable ? bestPage(qTerms, index) : null;

  /* For a question the agent answered, the reply's own wording is scored
   * against the same page. A high question score with a low answer score
   * means the page is about the right subject but the reply's specifics
   * are not on it — a prompt to look, nothing more.
   *
   * Only where there is an actual answer. An unanswered question's
   * "reply" is a not-found notice or nothing at all, and scoring that
   * against the page yields a meaningless 0% sitting next to "not
   * answered", which reads as evidence when it is an artefact. */
  const answered = question.answerEvaluation === ANSWER_EVALUATION.ANSWERED;
  const answerTerms = answered && answerText ? [...new Set(terms(answerText))] : [];
  const answerScore = best && answerTerms.length ? scorePage(answerTerms, best.page, index.idf).score : null;

  /* A page is only named when something actually matched. With no
   * shared words the top of the ranking is just the first page, and
   * printing it as the "best matching page" next to a 0% score invites
   * the reader to go and check a page that was never a candidate. */
  const found = best && best.score > 0 ? best : null;

  return Object.freeze({
    questionId: question.questionId,
    verdict: verdictOf(best?.score ?? 0, question.answerEvaluation, checkable),
    score: best?.score ?? 0,
    pageName: found?.page.name ?? "",
    pageFile: found?.page.file ?? "",
    matched: Object.freeze(best?.matched ?? []),
    missing: Object.freeze(best?.missing ?? []),
    terms: Object.freeze(qTerms),
    answerScore,
  });
}

/**
 * Checks every consolidated question.
 * @param questions   consolidateQuestions() output
 * @param index       indexKnowledge() output
 * @param answerTextOf (question) => the agent's reply text, for the answer score
 * @returns { byQuestionId: Map, counts, index }
 */
export function runKnowledgeCheck(questions, index, answerTextOf = () => "") {
  const byQuestionId = new Map();
  for (const q of questions) {
    byQuestionId.set(q.questionId, checkQuestion(q, index, { answerText: answerTextOf(q) }));
  }
  const counts = {};
  for (const v of Object.values(KNOWLEDGE_VERDICT)) counts[v] = 0;
  for (const r of byQuestionId.values()) counts[r.verdict] += 1;
  return { byQuestionId, counts, index };
}
