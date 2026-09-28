import React, { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Copy, Check, Download, FileJson, FileSpreadsheet, ShieldAlert, Search, Upload,
} from "lucide-react";
import { LAYER_DERIVED } from "../../lib/responses/views";
import { buildQuestionRequest, ANSWER_EVALUATION } from "../../lib/responses/ai/questionPackage";
import { validateQuestionReply } from "../../lib/responses/ai/questionResult";
import { DEFAULT_PROVIDER } from "../../lib/responses/ai/provider";
import { exportQuestionWorkbook, WORKBOOK_FILENAME, answerCell } from "../../lib/responses/export/questionWorkbook";
import { XLSX_MIME } from "../../lib/responses/export/xlsxWriter";
import { saveBlob } from "../BenchmarkExport";
import { LayerBadge, Stat, FlagBadge, formatUtc } from "./common";
import { StatusBadge } from "./ExtractedQA";

/* The Response Consolidator's main view. The app exists to tell us what
 * AFAIK users are actually asking, preserve those real questions, turn
 * repeated questions into clean reusable ones, and export that question
 * master. Everything on this page serves that. */

export const EVALUATION_STYLE = {
  [ANSWER_EVALUATION.ANSWERED]: { tone: "emerald", label: "Answered" },
  [ANSWER_EVALUATION.PARTIALLY_ANSWERED]: { tone: "amber", label: "Partially answered" },
  [ANSWER_EVALUATION.NOT_ANSWERED]: { tone: "rose", label: "Not answered" },
  [ANSWER_EVALUATION.CANNOT_DETERMINE]: { tone: "slate", label: "Cannot determine" },
};

const EvaluationBadge = ({ value }) => <FlagBadge tone={EVALUATION_STYLE[value].tone}>{EVALUATION_STYLE[value].label}</FlagBadge>;

/* Validation outcome of a pasted reply — kept on screen with the result
 * it justified. */
export function ValidationSummary({ result }) {
  const c = result.coverage;
  const cell = (label, value, bad) => (
    <div className={"rounded-lg border px-3 py-2 " + (bad ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white")}>
      <div className={"text-lg font-semibold tabular-nums " + (bad ? "text-rose-700" : "text-slate-900")}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
  return (
    <div className={"rounded-xl border p-4 " + (result.ok ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50")}>
      <div className={"flex items-center gap-2 text-sm font-semibold " + (result.ok ? "text-emerald-800" : "text-rose-800")}>
        {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {result.ok ? "Reply accepted — every question is accounted for exactly once." : "Reply rejected — nothing was imported."}
      </div>
      {!c.evaluated && <div className="mt-2 text-xs text-rose-800">QA ID coverage was not checked: the reply could not be read. {c.expected} QA IDs expected.</div>}
      {c.evaluated && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
          {cell("expected", c.expected, false)}
          {cell("assigned", c.assigned, c.assigned !== c.expected)}
          {cell("missing", c.missing.length, c.missing.length > 0)}
          {cell("duplicated", c.duplicated.length, c.duplicated.length > 0)}
          {cell("unknown", c.unknown.length, c.unknown.length > 0)}
          {cell("conversational", c.conversational.length, c.conversational.length > 0)}
        </div>
      )}
      {result.errors.length > 0 && <ul className="mt-3 space-y-1 text-xs text-rose-800 list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {result.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-800 list-disc pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}

function ClaudeStep({ records, result, onImported }) {
  const [copied, setCopied] = useState("");
  const [reply, setReply] = useState("");
  const [attempt, setAttempt] = useState(null);
  const provider = DEFAULT_PROVIDER;
  const request = useMemo(() => buildQuestionRequest(records), [records]);
  const { promptText } = useMemo(() => provider.render(request), [provider, request]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied("Prompt copied. Paste it into Claude, then paste Claude's JSON answer below.");
    } catch {
      setCopied("The browser blocked clipboard access. Use “Download prompt” instead.");
    }
  };
  const validateAndImport = (text) => {
    const r = validateQuestionReply(text, request);
    setAttempt(r);
    if (r.ok) onImported(r, request);
  };

  return (
    <details open={!result} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer p-4 text-sm font-semibold text-slate-800">
        {result ? "Consolidate again with Claude" : "Consolidate the questions with Claude"}
        <span className="ml-2 font-normal text-slate-500">— {request.items.length} information questions, package {request.packageId}</span>
      </summary>
      <div className="border-t border-slate-100 p-4 space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            The prompt contains real employee questions and AFAIK's answers. It leaves this app only when you copy or
            download it. Paste it only into a Claude workspace approved for this data. Session IDs and file names are not
            included.
          </span>
        </div>
        <ol className="space-y-3 text-sm text-slate-700">
          <li>
            <span className="font-semibold">1. Copy the prompt and send it to Claude.</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
                {copied.startsWith("Prompt copied") ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy Claude prompt
              </button>
              <button
                onClick={() => saveBlob("AFAIK_question-consolidation_prompt.txt", new Blob([promptText], { type: "text/plain" }))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> Download prompt
              </button>
              {copied && <span className="text-xs text-slate-500">{copied}</span>}
            </div>
            {request.excluded.length > 0 && (
              <div className="mt-2 text-xs text-slate-500">
                Not sent (conversational, kept in Extracted Q&amp;A): {request.excluded.map((x) => `${x.qaId} “${x.question.trim()}”`).join(" · ")}
              </div>
            )}
          </li>
          <li>
            <span className="font-semibold">2. Paste Claude's JSON answer and import it.</span>
            <div className="text-xs text-slate-500 mt-0.5">
              It is checked before anything is kept: the package must match and each of the {request.items.length} QA IDs must appear exactly once.
            </div>
            <textarea
              value={reply} onChange={(e) => setReply(e.target.value)} rows={5} spellCheck={false}
              placeholder='{"packageId": "…", "questions": [ … ]}' aria-label="Claude's JSON reply"
              className="mt-2 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => validateAndImport(reply)} disabled={!reply.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" /> Validate &amp; import
              </button>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                <FileJson className="h-3.5 w-3.5" /> Load reply file
                <input type="file" accept=".json,.txt" className="hidden"
                  onChange={async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) { const t = await f.text(); setReply(t); validateAndImport(t); } }} />
              </label>
            </div>
          </li>
        </ol>
        {attempt && <ValidationSummary result={attempt} />}
        <details>
          <summary className="cursor-pointer text-xs font-medium text-slate-600">Show the full prompt text</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs font-mono text-slate-700 max-h-[28rem] overflow-y-auto">{promptText}</pre>
        </details>
      </div>
    </details>
  );
}

function Originals({ question, recordsById, onOpenQA }) {
  return (
    <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Clean question · derived</div>
          <div className="mt-1 text-sm text-slate-900">{question.cleanQuestion}</div>
        </div>
        {question.notes && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Claude's notes</div>
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

export default function QuestionConsolidation({ records, recordsById, workspaceSummary, qaSummary, result, onImported, onOpenQA, onGoImport }) {
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

  const questions = result?.questions ?? [];
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
      const bytes = await exportQuestionWorkbook({
        records, questions, summary: workspaceSummary, packageId: result.packageId, exportedAt: new Date().toISOString(),
      });
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
          <Stat label="Consolidated questions" value={result ? questions.length : "—"} />
          <Stat label="Asked more than once" value={result ? repeated : "—"} />
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <button
            onClick={exportExcel} disabled={!result || exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-4 w-4" /> {exporting ? "Preparing…" : "Export Consolidated Excel"}
          </button>
          <span className="text-xs text-slate-600">
            {result
              ? <>{WORKBOOK_FILENAME} — sheets RAW_Q&amp;A ({records.length} rows), CONSOLIDATED_QUESTIONS ({questions.length}), SUMMARY.</>
              : "Available once Claude's consolidation has been imported below."}
          </span>
          {exportError && <span className="text-xs text-rose-700">Export failed: {exportError}</span>}
        </div>
        {result && <ValidationSummary result={result} />}
      </div>

      <ClaudeStep records={records} result={result} onImported={onImported} />

      {result && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
            <label className="relative flex-1 min-w-[14rem]">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search clean and original questions…"
                className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm" />
            </label>
            <select value={evaluation} onChange={(e) => setEvaluation(e.target.value)} aria-label="Answer result filter"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
              <option value="">All answer results</option>
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
                <th className="px-2 py-2 font-medium">Question ID</th>
                <th className="px-2 py-2 font-medium">Clean question</th>
                <th className="px-2 py-2 font-medium text-right">Occurrences</th>
                <th className="px-4 py-2 font-medium">Answer result</th>
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
      )}
    </div>
  );
}
