import React, { useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, Search, Upload } from "lucide-react";
import { LAYER_DERIVED } from "../../lib/responses/views";
import { ANSWER_EVALUATION, EXACT_MATCH_RULE } from "../../lib/responses/consolidate";
import { exportQuestionWorkbook, WORKBOOK_FILENAME, answerCell } from "../../lib/responses/export/questionWorkbook";
import { XLSX_MIME } from "../../lib/responses/export/xlsxWriter";
import { saveBlob } from "../../lib/download";
import { LayerBadge, Stat, FlagBadge, formatUtc } from "./common";
import { StatusBadge } from "./ExtractedQA";

/* The Response Consolidator's main view: what AFAIK users are actually
 * asking, repeated questions consolidated, every original kept
 * underneath, and the Excel export. */

export const EVALUATION_STYLE = {
  [ANSWER_EVALUATION.ANSWERED]: { tone: "emerald", label: "Answered" },
  [ANSWER_EVALUATION.PARTIALLY_ANSWERED]: { tone: "amber", label: "Partially answered" },
  [ANSWER_EVALUATION.NOT_ANSWERED]: { tone: "rose", label: "Not answered" },
  [ANSWER_EVALUATION.CANNOT_DETERMINE]: { tone: "slate", label: "Cannot determine" },
};

const EvaluationBadge = ({ value }) => <FlagBadge tone={EVALUATION_STYLE[value].tone}>{EVALUATION_STYLE[value].label}</FlagBadge>;

function Originals({ question, recordsById, onOpenQA }) {
  return (
    <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-2">
      {question.notes && <div className="text-xs text-slate-600">{question.notes}</div>}
      {question.qaIds.map((id) => {
        const r = recordsById.get(id);
        if (!r) return <div key={id} className="text-xs text-rose-700">{id}: not in the current dataset</div>;
        return (
          <div key={id} className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
              <button onClick={() => onOpenQA(id)} className="font-mono text-sky-700 hover:underline" title="Open in Extracted Q&A">{id}</button>
              <StatusBadge status={r.answerStatus} />
              <span>{formatUtc(r.timestamp, r.timestampRaw)}</span>
            </div>
            <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="text-sm text-slate-900 whitespace-pre-wrap break-words">{r.question}</div>
              <div className="text-xs text-slate-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{answerCell(r) || <span className="text-slate-400">— no agent reply</span>}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function QuestionConsolidation({ records, recordsById, questions, workspaceSummary, qaSummary, onOpenQA, onGoImport }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [text, setText] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [repeatedOnly, setRepeatedOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No questions yet — import session exports first.
        <div className="mt-3">
          <button onClick={onGoImport} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import responses
          </button>
        </div>
      </div>
    );
  }

  const repeated = questions.filter((q) => q.qaIds.length > 1).length;
  const needle = text.trim().toLowerCase();
  const rows = questions.filter((q) =>
    (!evaluation || q.answerEvaluation === evaluation) &&
    (!repeatedOnly || q.qaIds.length > 1) &&
    (!needle || [q.questionId, q.cleanQuestion, ...q.qaIds, ...q.qaIds.map((id) => recordsById.get(id)?.question ?? "")].join("\n").toLowerCase().includes(needle)));
  const toggle = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportExcel = async () => {
    setExporting(true); setExportError("");
    try {
      const bytes = await exportQuestionWorkbook({ records, questions, summary: workspaceSummary, exportedAt: new Date().toISOString() });
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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-900">Question Consolidation</h1>
          <LayerBadge layer={LAYER_DERIVED} />
          <button
            onClick={exportExcel} disabled={exporting} title={WORKBOOK_FILENAME}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" /> {exporting ? "Preparing…" : "Export Excel"}
          </button>
        </div>
        {exportError && <div className="text-xs text-rose-700">Export failed: {exportError}</div>}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Information questions" value={qaSummary.informationRequests} />
          <Stat label="Consolidated questions" value={questions.length} />
          <Stat label="Asked more than once" value={repeated} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <label className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search questions…"
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
            Repeated only
          </label>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              <th className="px-2 py-2 font-medium">ID</th>
              <th className="px-2 py-2 font-medium" title={EXACT_MATCH_RULE}>Question</th>
              <th className="px-2 py-2 font-medium text-right">Asked</th>
              <th className="px-4 py-2 font-medium">Answer status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => {
              const open = expanded.has(q.questionId);
              return (
                <React.Fragment key={q.questionId}>
                  <tr onClick={() => toggle(q.questionId)} className="border-b border-slate-50 align-top cursor-pointer hover:bg-slate-50">
                    <td className="pl-3 py-2 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{q.questionId}</td>
                    <td className="px-2 py-2 text-slate-900">{q.cleanQuestion}</td>
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
