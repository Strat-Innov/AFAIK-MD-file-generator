import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, Search, Upload, Info, Sparkles, Copy, Check, Undo2 } from "lucide-react";
import { LAYER_DERIVED } from "../../lib/responses/views";
import { ANSWER_EVALUATION, EXACT_MATCH_RULE } from "../../lib/responses/consolidate";
import { buildConsolidationRequest, renderConsolidationPrompt, validateConsolidationReply } from "../../lib/responses/ai/semanticConsolidation";
import { exportQuestionWorkbook, WORKBOOK_FILENAME, answerCell } from "../../lib/responses/export/questionWorkbook";
import { XLSX_MIME } from "../../lib/responses/export/xlsxWriter";
import { saveBlob } from "../BenchmarkExport";
import { LayerBadge, Stat, FlagBadge, formatUtc } from "./common";
import { StatusBadge } from "./ExtractedQA";

/* The Response Consolidator's main view. The app exists to tell us what
 * AFAIK users are actually asking, preserve those real questions, turn
 * repeated questions into clean reusable ones, and export that question
 * master. Everything on this page serves that.
 *
 * Two layers: exact-match INITIAL GROUPS, always there; and optional
 * AI-assisted CONSOLIDATED QUESTIONS. The export works from whichever is
 * current and never waits for the AI step. */

export const EVALUATION_STYLE = {
  [ANSWER_EVALUATION.ANSWERED]: { tone: "emerald", label: "Answered" },
  [ANSWER_EVALUATION.PARTIALLY_ANSWERED]: { tone: "amber", label: "Partially answered" },
  [ANSWER_EVALUATION.NOT_ANSWERED]: { tone: "rose", label: "Not answered" },
  [ANSWER_EVALUATION.CANNOT_DETERMINE]: { tone: "slate", label: "Cannot determine" },
};

const EvaluationBadge = ({ value }) => <FlagBadge tone={EVALUATION_STYLE[value].tone}>{EVALUATION_STYLE[value].label}</FlagBadge>;

function Originals({ question, recordsById, onOpenQA }) {
  return (
    <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Clean question · derived</div>
          {question.groupIds && question.groupIds.length > 0 && (
            <div className="text-[11px] text-slate-400">from initial group{question.groupIds.length > 1 ? "s" : ""} {question.groupIds.join(", ")}</div>
          )}
          <div className="mt-1 text-sm text-slate-900">{question.cleanQuestion}</div>
        </div>
        {question.notes && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</div>
            <div className="mt-1 text-xs text-slate-600">{question.notes}</div>
          </div>
        )}
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Original questions · raw, exactly as asked ({question.qaIds.length})
      </div>
      <div className="space-y-2">
        {question.qaIds.map((id) => {
          const r = recordsById.get(id);
          if (!r) return <div key={id} className="text-xs text-rose-700">{id}: not in the current dataset</div>;
          return (
            <div key={id} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                <button onClick={() => onOpenQA(id)} className="font-mono text-sky-700 hover:underline" title="Open in Extracted Q&A (and from there the raw session)">{id}</button>
                <StatusBadge status={r.answerStatus} />
                <span>{formatUtc(r.timestamp, r.timestampRaw)}</span>
                <span className="break-all">{r.sourceFiles[0]}{r.sourceRows[0] ? ` · row ${r.sourceRows[0].rowNumber}` : ""}</span>
              </div>
              <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">User asked</div>
                  <div className="text-sm text-slate-900 whitespace-pre-wrap break-words">{r.question}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Agent answered</div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{answerCell(r) || <span className="text-slate-400">— no agent reply</span>}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Optional: merge reworded questions with Claude. Copy the prompt, paste
 * the reply. A wrong paste is explained, never fatal, and nothing here
 * gates the export. */
function AiStep({ records, initialGroups, applied, onApply, onRevert }) {
  const request = useMemo(() => buildConsolidationRequest(records, initialGroups), [records, initialGroups]);
  const prompt = useMemo(() => renderConsolidationPrompt(request), [request]);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [result, setResult] = useState(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { setCopied(false); }
  };
  const apply = () => {
    const r = validateConsolidationReply(reply, request);
    setResult(r);
    if (r.ok) { onApply(r.questions); setReply(""); }
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-white shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles className="h-4 w-4 text-violet-600" /> Merge reworded questions with Claude
          <span className="font-normal text-slate-500">— optional</span>
        </div>
        {applied && (
          <button onClick={onRevert} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 underline">
            <Undo2 className="h-3.5 w-3.5" /> Back to initial groups
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600">
        Exact matching cannot tell that “South Station 1BR price?” and “How much does a 1-BR unit cost at South Station?”
        are the same question. Claude can: it decides which of the {initialGroups.length} initial groups ask for the same
        information and writes one clean question for each. The app keeps every original question and works out counts and
        answer status itself. The prompt contains real employee questions — it leaves the app only when you copy it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Prompt copied — paste it into Claude" : "1. Copy prompt for Claude"}
        </button>
      </div>
      <textarea
        value={reply} onChange={(e) => setReply(e.target.value)} rows={3} spellCheck={false}
        placeholder="2. Paste Claude's answer here"
        aria-label="Claude's answer"
        className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={apply} disabled={!reply.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40">
          <Sparkles className="h-3.5 w-3.5" /> 3. Apply
        </button>
        {result?.ok && <span className="text-xs text-emerald-700">Applied — all {result.coverage.expected} initial groups accounted for exactly once.</span>}
      </div>
      {result && !result.ok && (
        <ul className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 list-disc pl-6 space-y-1">
          {result.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function QuestionConsolidation({
  records, recordsById, initialGroups, consolidated, workspaceSummary, qaSummary, onApplyAi, onRevertAi, onOpenQA, onGoImport,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [text, setText] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [repeatedOnly, setRepeatedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No extracted questions yet — import session exports first.
        <div className="mt-3">
          <button onClick={onGoImport} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import responses
          </button>
        </div>
      </div>
    );
  }

  const ai = Array.isArray(consolidated);
  // One list, whichever layer is current.
  const questions = ai
    ? consolidated.map((q) => ({ id: q.questionId, ...q }))
    : initialGroups.map((g) => ({ id: g.groupId, ...g, groupIds: [] }));
  const repeated = questions.filter((q) => q.qaIds.length > 1).length;
  const needle = text.trim().toLowerCase();
  const rows = questions.filter((q) =>
    (!evaluation || q.answerEvaluation === evaluation) &&
    (!repeatedOnly || q.qaIds.length > 1) &&
    (!needle || [q.id, q.cleanQuestion, ...q.qaIds, ...q.qaIds.map((id) => recordsById.get(id)?.question ?? "")].join("\n").toLowerCase().includes(needle)));
  const toggle = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportExcel = async () => {
    setExporting(true); setExportError("");
    try {
      const bytes = await exportQuestionWorkbook({ records, initialGroups, consolidated, summary: workspaceSummary, exportedAt: new Date().toISOString() });
      saveBlob(WORKBOOK_FILENAME, new Blob([bytes], { type: XLSX_MIME }));
    } catch (e) {
      setExportError(e.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">Question Consolidation</h1>
          <LayerBadge layer={LAYER_DERIVED} note="clean questions from real user questions" />
        </div>
        <p className="text-sm text-slate-600">
          What are AFAIK users actually asking? Repeated and reworded questions are consolidated into clean, reusable
          questions. The original questions and answers are kept unchanged underneath every clean question.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Q&A pairs" value={qaSummary.records} />
          <Stat label="Information questions" value={qaSummary.informationRequests} />
          <Stat label="Conversational (not consolidated)" value={qaSummary.conversational} />
          <Stat label="Initial groups (exact match)" value={initialGroups.length} />
          <Stat label="Consolidated questions (AI)" value={ai ? consolidated.length : "—"} tone={ai ? "emerald" : "slate"} />
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <button
            onClick={exportExcel} disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" /> {exporting ? "Preparing…" : "Export Consolidated Excel"}
          </button>
          <span className="text-xs text-slate-600">
            {WORKBOOK_FILENAME} — RAW_Q&amp;A ({records.length} rows), CONSOLIDATED_QUESTIONS ({questions.length}, {ai ? "AI-assisted" : "initial groups — AI step not applied"}), SUMMARY.
          </span>
          {exportError && <span className="text-xs text-rose-700">Export failed: {exportError}</span>}
        </div>
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Initial groups: {EXACT_MATCH_RULE} Answer status comes from the transcript and says what the interaction shows,
            not whether an answer was factually right: agent unavailable, no reply or an explicit “could not find” is
            <em> Not answered</em>; a redacted or export-truncated reply is <em>Cannot determine</em>.
          </span>
        </div>
      </div>

      <AiStep records={records} initialGroups={initialGroups} applied={ai} onApply={onApplyAi} onRevert={onRevertAi} />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <span className="text-sm font-semibold text-slate-800">{ai ? "Consolidated questions (AI-assisted)" : "Initial groups (exact match)"}</span>
          <label className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search clean and original questions…"
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm" />
          </label>
          <select value={evaluation} onChange={(e) => setEvaluation(e.target.value)} aria-label="Answer status filter"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
            <option value="">All answer statuses</option>
            {Object.values(ANSWER_EVALUATION).map((v) => (
              <option key={v} value={v}>{EVALUATION_STYLE[v].label} ({questions.filter((q) => q.answerEvaluation === v).length})</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={repeatedOnly} onChange={(e) => setRepeatedOnly(e.target.checked)} />
            Asked more than once ({repeated})
          </label>
          <span className="ml-auto text-xs text-slate-500">Showing {rows.length} of {questions.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              <th className="px-2 py-2 font-medium">{ai ? "Question ID" : "Group ID"}</th>
              <th className="px-2 py-2 font-medium">Clean question</th>
              <th className="px-2 py-2 font-medium text-right">Occurrences</th>
              <th className="px-4 py-2 font-medium">Answer status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const open = expanded.has(q.id);
              return (
                <React.Fragment key={q.id}>
                  <tr onClick={() => toggle(q.id)} className="border-b border-slate-50 align-top cursor-pointer hover:bg-slate-50">
                    <td className="pl-3 py-2 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{q.id}</td>
                    <td className="px-2 py-2 text-slate-900">
                      {q.cleanQuestion}
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">{q.qaIds.join(" · ")}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{q.qaIds.length}</td>
                    <td className="px-4 py-2"><EvaluationBadge value={q.answerEvaluation} /></td>
                  </tr>
                  {open && <tr><td colSpan={5} className="p-0"><Originals question={q} recordsById={recordsById} onOpenQA={onOpenQA} /></td></tr>}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-slate-400">No questions match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
