/* ------------------------------------------------------------------ *
 * AFAIK_Question_Consolidated.xlsx — the Response Consolidator's main
 * deliverable.
 *
 *   RAW_Q&A                 every extracted Q&A record, values exactly as
 *                           imported (RAW — the source of truth)
 *   CONSOLIDATED_QUESTIONS  the clean question list (DERIVED)
 *   SUMMARY                 headline counts
 *
 * The two data sheets link both ways: each clean question lists its QA
 * IDs, and each raw row names the question it went into.
 * ------------------------------------------------------------------ */

import { createXlsx } from "./xlsxWriter.js";
import { ANSWER_EVALUATION, EXACT_MATCH_RULE } from "../consolidate.js";
import { QUESTION_KIND } from "../qa.js";
import { KNOWLEDGE_VERDICT, KNOWLEDGE_CHECK_RULE } from "../knowledgeCheck.js";

export const WORKBOOK_FILENAME = "AFAIK_Question_Consolidated.xlsx";

/* Plain wording for the knowledge check, so the sheet reads without
 * this app open next to it. */
const VERDICT_LABEL = {
  [KNOWLEDGE_VERDICT.SUPPORTED]: "Supported",
  [KNOWLEDGE_VERDICT.RETRIEVAL_GAP]: "Retrieval Gap — in the file, not answered",
  [KNOWLEDGE_VERDICT.ANSWER_NOT_IN_KB]: "Answered Off-File — reply not matched in the file",
  [KNOWLEDGE_VERDICT.KNOWLEDGE_GAP]: "Content Missing — not in the file",
  [KNOWLEDGE_VERDICT.WEAK_MATCH]: "Weak Match — read it",
  [KNOWLEDGE_VERDICT.CANNOT_CHECK]: "Cannot Check",
};

const EVALUATION_LABEL = {
  [ANSWER_EVALUATION.ANSWERED]: "Answered",
  [ANSWER_EVALUATION.PARTIALLY_ANSWERED]: "Partially Answered",
  [ANSWER_EVALUATION.NOT_ANSWERED]: "Not Answered",
  [ANSWER_EVALUATION.CANNOT_DETERMINE]: "Cannot Determine",
};

/** Answer parts as one cell: exact text, labelled only when there are several. */
export function answerCell(record) {
  const parts = record.answerParts;
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].text;
  return parts.map((p, i) => `[Part ${i + 1}] ${p.text}`).join("\n\n");
}

/**
 * @param data.records    all Extracted Q&A records (Layer 2)
 * @param data.questions  consolidated questions (consolidateQuestions())
 * @param data.summary    { files, sessions } from the raw workspace
 * @param data.exportedAt ISO timestamp (caller's clock)
 * @returns the sheet definitions for createXlsx()
 */
export function buildQuestionSheets({ records, questions, summary, exportedAt, knowledge }) {
  const questionByQa = new Map();
  for (const q of questions) for (const id of q.qaIds) questionByQa.set(id, q.questionId);
  const byId = new Map(records.map((r) => [r.id, r]));

  const raw = {
    name: "RAW_Q&A",
    columns: [
      { header: "QA ID", width: 10 },
      { header: "Timestamp (UTC)", width: 22 },
      { header: "User Question", width: 50, wrap: true },
      { header: "Answer", width: 80, wrap: true },
      { header: "Status", width: 18 },
      { header: "Question Type", width: 16 },
      { header: "Question ID", width: 12 },
      { header: "Channel", width: 12 },
      { header: "Source File", width: 34 },
      { header: "Source Row", width: 10 },
      { header: "Session ID", width: 40 },
    ],
    rows: records.map((r) => [
      r.id,
      r.timestamp ?? r.timestampRaw,
      r.question,
      answerCell(r),
      r.answerStatus,
      r.questionKind === QUESTION_KIND.CONVERSATIONAL ? "Conversational" : "Information",
      questionByQa.get(r.id) ?? "",
      r.channel,
      r.sourceRows.map((o) => o.filename).join("; "),
      r.sourceRows.length === 1 ? r.sourceRows[0].rowNumber : r.sourceRows.map((o) => o.rowNumber).join("; "),
      r.sessionId,
    ]),
  };

  /* The knowledge columns appear only when a knowledge file was
   * checked. Without one there is nothing to put in them, and an empty
   * column reads as a finding of "nothing found". */
  const checked = Boolean(knowledge);
  const knowledgeColumns = checked ? [
    { header: "Knowledge Check", width: 44 },
    { header: "Question Words Found %", width: 20 },
    { header: "Best Matching Page", width: 46, wrap: true },
    { header: "Question Words Not Found", width: 40, wrap: true },
    { header: "Reply Words On That Page %", width: 22 },
  ] : [];
  const knowledgeCells = (q) => {
    if (!checked) return [];
    const r = knowledge.byQuestionId.get(q.questionId);
    if (!r) return ["", "", "", "", ""];
    const unchecked = r.verdict === KNOWLEDGE_VERDICT.CANNOT_CHECK;
    return [
      VERDICT_LABEL[r.verdict],
      unchecked ? "" : Math.round(r.score * 100),
      r.pageName,
      r.missing.join(", "),
      r.answerScore === null ? "" : Math.round(r.answerScore * 100),
    ];
  };

  const questionSheet = {
    name: "CONSOLIDATED_QUESTIONS",
    columns: [
      { header: "Question ID", width: 12 },
      { header: "Clean Question", width: 60, wrap: true },
      { header: "Occurrence Count", width: 12 },
      { header: "Original QA IDs", width: 24, wrap: true },
      { header: "Original Questions", width: 60, wrap: true },
      { header: "Answer Status", width: 20 },
      { header: "Notes", width: 60, wrap: true },
      ...knowledgeColumns,
    ],
    rows: questions.map((q) => [
      q.questionId,
      q.cleanQuestion,
      q.qaIds.length,
      q.qaIds.join(", "),
      q.qaIds.map((id) => byId.get(id)?.question ?? "").join("\n"),
      EVALUATION_LABEL[q.answerEvaluation],
      q.notes,
      ...knowledgeCells(q),
    ]),
  };

  const count = (ev) => questions.filter((q) => q.answerEvaluation === ev).length;
  const info = records.filter((r) => r.questionKind === QUESTION_KIND.INFORMATION_REQUEST).length;
  const metrics = [
    ["Files Imported", summary.files, "Session export files imported"],
    ["Sessions", summary.sessions, "Unique AFAIK Agent sessions"],
    ["Total Q&A", records.length, "User messages extracted from the transcripts (RAW_Q&A rows)"],
    ["Information Questions", info, "Q&A records asking for information — the input to consolidation"],
    ["Conversational Questions", records.length - info, "Greetings and filler, kept in RAW_Q&A but not consolidated"],
    ["Consolidated Questions", questions.length, EXACT_MATCH_RULE],
    ["Repeated Questions", questions.filter((q) => q.qaIds.length > 1).length, "Clean questions asked more than once"],
    ["Answered", count(ANSWER_EVALUATION.ANSWERED), "Answer status from the transcript — not a check of factual correctness"],
    ["Partially Answered", count(ANSWER_EVALUATION.PARTIALLY_ANSWERED), "Clean questions answered in part"],
    ["Not Answered", count(ANSWER_EVALUATION.NOT_ANSWERED), "Clean questions the agent did not answer"],
    ["Cannot Determine", count(ANSWER_EVALUATION.CANNOT_DETERMINE), "The transcript does not show enough to judge"],
  ];
  if (checked) {
    metrics.push(
      ["Knowledge Pages Indexed", knowledge.index.pageCount, KNOWLEDGE_CHECK_RULE],
      ["Knowledge Files", knowledge.index.sources.map((k) => k.file).join(", "), "Knowledge files checked against"],
      ...Object.values(KNOWLEDGE_VERDICT).map((v) => [VERDICT_LABEL[v], knowledge.counts[v], ""]),
    );
  }
  metrics.push(["Exported (UTC)", exportedAt, ""]);
  const summarySheet = {
    name: "SUMMARY",
    columns: [{ header: "Metric", width: 26 }, { header: "Value", width: 26 }, { header: "Meaning", width: 70, wrap: true }],
    rows: metrics,
  };

  return [raw, questionSheet, summarySheet];
}

export function exportQuestionWorkbook(data) {
  return createXlsx(buildQuestionSheets(data), { modifiedAt: new Date(data.exportedAt) });
}
