import React, { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertTriangle, Sparkles } from "lucide-react";
import { LAYER_DERIVED } from "../../lib/responses/views";
import { REVIEW_STATUS } from "../../lib/responses/ai/intentResult";
import { LayerBadge, Stat, FlagBadge, formatUtc } from "./common";
import { StatusBadge } from "./ExtractedQA";

/* Validation outcome of an AI reply — shown on the import panel (for a
 * rejected reply) and here (for the accepted one), so the coverage that
 * justified trusting the grouping stays on screen with it. */
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
      {!c.evaluated && (
        <div className="mt-2 text-xs text-rose-800">QA ID coverage was not checked: the reply could not be read. {c.expected} QA IDs expected.</div>
      )}
      {c.evaluated && <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
        {cell("expected", c.expected, false)}
        {cell("assigned", c.assigned, c.assigned !== c.expected)}
        {cell("missing", c.missing.length, c.missing.length > 0)}
        {cell("duplicated", c.duplicated.length, c.duplicated.length > 0)}
        {cell("unknown", c.unknown.length, c.unknown.length > 0)}
        {cell("conversational", c.conversational.length, c.conversational.length > 0)}
      </div>}
      {result.errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-rose-800 list-disc pl-5">
          {result.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-800 list-disc pl-5">
          {result.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}

const REVIEW_LABEL = {
  [REVIEW_STATUS.PENDING]: "Pending",
  [REVIEW_STATUS.ACCEPTED]: "Accepted",
  [REVIEW_STATUS.REJECTED]: "Rejected",
  [REVIEW_STATUS.NEEDS_REVIEW]: "Needs review",
};
const CONFIDENCE_TONE = { high: "emerald", medium: "slate", low: "amber" };

export default function IntentCandidates({ result, recordsById, review, onReview, onOpenQA, onGoConsolidation }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [gapOnly, setGapOnly] = useState(false);
  const [reviewFilter, setReviewFilter] = useState("");

  const statusOf = (it) => review[it.intentId] ?? REVIEW_STATUS.PENDING;
  const intents = result?.intents ?? [];
  const rows = intents.filter((it) => (!gapOnly || it.potentialKnowledgeGap) && (!reviewFilter || statusOf(it) === reviewFilter));

  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No intent candidates yet. Generate the prompt, ask Claude, and import its reply on the AI Consolidation page.
        <div className="mt-3">
          <button onClick={onGoConsolidation} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Sparkles className="h-3.5 w-3.5" /> Go to AI Consolidation
          </button>
        </div>
      </div>
    );
  }

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const reviewCounts = Object.fromEntries(Object.values(REVIEW_STATUS).map((s) => [s, intents.filter((it) => statusOf(it) === s).length]));
  const gaps = intents.filter((it) => it.potentialKnowledgeGap).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-slate-800">Intent Candidates</h1>
          <LayerBadge layer={LAYER_DERIVED} note="AI grouping of user questions · for human review" />
          <span className="text-xs text-slate-400 ml-auto">{result.packageId} · imported {formatUtc(result.importedAt)}</span>
        </div>
        <p className="text-sm text-slate-600">
          Each candidate is one information need that users asked about. Titles, needs and gap rationales are Claude's
          wording; the questions underneath are the originals, unchanged. A potential knowledge gap is a flag for review,
          not a finding. No answers are generated at this stage.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Intent candidates" value={intents.length} />
          <Stat label="Questions assigned" value={`${result.coverage.assigned} / ${result.coverage.expected}`} />
          <Stat label="Potential knowledge gaps" value={gaps} tone={gaps ? "amber" : "slate"} />
          <Stat label="Reviewed (accepted / rejected)" value={`${reviewCounts.ACCEPTED} / ${reviewCounts.REJECTED}`} />
        </div>
        <ValidationSummary result={result} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={gapOnly} onChange={(e) => setGapOnly(e.target.checked)} />
            Potential knowledge gaps only ({gaps})
          </label>
          <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} aria-label="Review status filter"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
            <option value="">All review statuses</option>
            {Object.values(REVIEW_STATUS).map((s) => <option key={s} value={s}>{REVIEW_LABEL[s]} ({reviewCounts[s]})</option>)}
          </select>
          <span className="ml-auto text-xs text-slate-500">Showing {rows.length} of {intents.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-8" />
                <th className="px-2 py-2 font-medium">Intent</th>
                <th className="px-2 py-2 font-medium">Information need</th>
                <th className="px-2 py-2 font-medium text-right">Questions</th>
                <th className="px-2 py-2 font-medium">Potential gap</th>
                <th className="px-2 py-2 font-medium">Confidence</th>
                <th className="px-4 py-2 font-medium">Review status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const open = expanded.has(it.intentId);
                return (
                  <React.Fragment key={it.intentId}>
                    <tr className="border-b border-slate-50 align-top hover:bg-slate-50">
                      <td className="pl-3 py-2 text-slate-400 cursor-pointer" onClick={() => toggle(it.intentId)}>
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-2 py-2 cursor-pointer min-w-[12rem]" onClick={() => toggle(it.intentId)}>
                        <div className="font-mono text-xs text-slate-500">{it.intentId}</div>
                        <div className="font-medium text-slate-800">{it.intentTitle}</div>
                      </td>
                      <td className="px-2 py-2 text-slate-600 min-w-[16rem] cursor-pointer" onClick={() => toggle(it.intentId)}>
                        {it.informationNeed}
                        <div className="mt-1 font-mono text-[11px] text-slate-400">{it.qaIds.join(" · ")}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{it.qaIds.length}</td>
                      <td className="px-2 py-2 min-w-[12rem]">
                        {it.potentialKnowledgeGap
                          ? <><FlagBadge tone="amber">Potential gap</FlagBadge><div className="mt-1 text-xs text-slate-600">{it.gapRationale}</div></>
                          : <span className="text-xs text-slate-400">No</span>}
                      </td>
                      <td className="px-2 py-2"><FlagBadge tone={CONFIDENCE_TONE[it.confidence]}>{it.confidence}</FlagBadge></td>
                      <td className="px-4 py-2">
                        <select
                          value={statusOf(it)} onChange={(e) => onReview(it.intentId, e.target.value)} aria-label={`Review status for ${it.intentId}`}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                        >
                          {Object.values(REVIEW_STATUS).map((s) => <option key={s} value={s}>{REVIEW_LABEL[s]}</option>)}
                        </select>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-2">
                            {it.notes && <div className="text-xs text-slate-600"><span className="font-semibold">Claude's notes:</span> {it.notes}</div>}
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Original questions — exact text</div>
                            <table className="w-full text-sm bg-white rounded-lg border border-slate-200">
                              <tbody>
                                {it.qaIds.map((id) => {
                                  const r = recordsById.get(id);
                                  return (
                                    <tr key={id} className="border-b border-slate-100 last:border-0 align-top">
                                      <td className="px-3 py-2 whitespace-nowrap">
                                        <button onClick={() => onOpenQA(id)} className="font-mono text-xs text-sky-700 hover:underline" title="Open in Extracted Q&A">{id}</button>
                                      </td>
                                      <td className="px-2 py-2 text-slate-800">{r ? r.question : <span className="text-rose-700">not in the current dataset</span>}</td>
                                      <td className="px-2 py-2 whitespace-nowrap">{r && <StatusBadge status={r.answerStatus} />}</td>
                                      <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{r?.answerType ?? "—"}</td>
                                      <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{r && formatUtc(r.timestamp, r.timestampRaw)}</td>
                                      <td className="px-3 py-2 text-xs text-slate-500 break-all">{r?.sourceFiles[0]}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-sm text-slate-400">No intents match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {result.warnings.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> The import carried warnings; see the validation summary above.</div>
      )}
    </div>
  );
}
