import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowRight, Search, Eye, EyeOff, Upload, Scissors } from "lucide-react";
import { LAYER_RAW } from "../../lib/responses/views";
import { ANSWER_STATUS, PART_KIND, TRUNCATION_MIN_LENGTH } from "../../lib/responses/qa";
import { PARSE_STATUS } from "../../lib/responses/transcript";
import { DEFAULT_QA_FILTERS, filterQA, sortQA } from "../../lib/responses/qaQuery";
import { facetValues } from "../../lib/responses/sessionQuery";
import { LayerBadge, FlagBadge, formatUtc } from "./common";

const PAGE = 100;

/* One colour per status, used everywhere a status appears. Only
 * ANSWERED is green: every other status means "not answer evidence". */
export const STATUS_STYLE = {
  [ANSWER_STATUS.ANSWERED]: { tone: "emerald", label: "Answered" },
  [ANSWER_STATUS.TRUNCATED]: { tone: "amber", label: "Truncated" },
  [ANSWER_STATUS.REDACTED]: { tone: "rose", label: "Redacted" },
  [ANSWER_STATUS.NO_RESPONSE]: { tone: "rose", label: "No response" },
  [ANSWER_STATUS.AGENT_UNAVAILABLE]: { tone: "slate", label: "Agent unavailable" },
};

const PART_NOTE = {
  [PART_KIND.TRUNCATED]: `The transcript export cut this message off at about ${TRUNCATION_MIN_LENGTH}–500 characters. That is a limit of the export, not a verdict on the answer: the question stays fully valid, and the answer's correctness is judged against the AFAIK knowledge source, never by reconstructing the missing text.`,
  [PART_KIND.REDACTED]: "Withheld by the export. No answer content is available.",
  [PART_KIND.UNAVAILABLE]: "Platform usage-limit notice, not an answer.",
};

const preview = (text, n = 140) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
};

export function StatusBadge({ status }) {
  const { tone, label } = STATUS_STYLE[status];
  return <FlagBadge tone={tone}>{label}</FlagBadge>;
}

function Detail({ record, session, onOpenSession }) {
  const yesNo = (v) => (v ? "Yes" : "No");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] p-4 bg-slate-50 border-t border-slate-100">
      <div className="min-w-0 space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            User question — turn {record.turnNumber}, exact text
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 font-mono">{record.question}</pre>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
            Agent answer — {record.answerParts.length === 0 ? "no agent message" : `${record.answerParts.length} part${record.answerParts.length > 1 ? "s" : ""}, exact text`}
          </div>
          {record.answerParts.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
              The user sent another message (or the session ended) before the agent replied.
            </div>
          )}
          <div className="space-y-2">
            {record.answerParts.map((p, i) => (
              <div key={p.turnNumber} className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Part {i + 1}</span>
                  <span>turn {p.turnNumber}</span>
                  {p.kind !== PART_KIND.NORMAL && <FlagBadge tone={p.kind === PART_KIND.UNAVAILABLE ? "slate" : p.kind === PART_KIND.TRUNCATED ? "amber" : "rose"}>{p.kind}</FlagBadge>}
                </div>
                <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-slate-800 font-mono">{p.text}</pre>
                {PART_NOTE[p.kind] && <div className="px-3 pb-2 text-xs text-slate-500">{PART_NOTE[p.kind]}</div>}
              </div>
            ))}
          </div>
        </div>
        {record.otherContent.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1.5">Other content in this answer's span (not an agent message)</div>
            {record.otherContent.map((c, i) => (
              <pre key={i} className="whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-mono text-slate-800 mb-1">
                {c.marker ? `${c.marker}: ` : ""}{c.text}
              </pre>
            ))}
          </div>
        )}
        {session && (
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">Source ChatTranscript — as exported ({session.turnsRaw || "?"} turns)</summary>
            <pre className="whitespace-pre-wrap break-words border-t border-slate-100 p-3 text-xs leading-relaxed text-slate-700 font-mono max-h-80 overflow-y-auto">{session.transcript}</pre>
          </details>
        )}
      </div>

      <div className="space-y-3 text-xs">
        <dl className="space-y-1.5">
          {[
            ["QA ID", record.id],
            ["Session ID", record.sessionId || "—"],
            ["Question in session", `${record.questionNumber} (turn ${record.turnNumber})`],
            ["Answer status", <StatusBadge key="s" status={record.answerStatus} />],
            ["Transcript completeness", { COMPLETE: "Complete", TRUNCATED: "Truncated by the export", NONE: "No answer content" }[record.answerCompleteness]],
            ["Needs review", yesNo(record.requiresReview)],
            ["Question kind", record.questionKind === "CONVERSATIONAL" ? "Conversational — kept, not consolidated" : "Information question"],
            ["Parse status", record.parseFlags.length ? record.parseFlags.join(", ") : PARSE_STATUS.OK],
            ["Session outcome", [record.sessionOutcome, record.outcomeReason].filter(Boolean).join(" · ") || "—"],
            ["Channel", record.channel || "—"],
            ["InitialUserMessage (reference only)", record.initialUserMessage || "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="text-slate-500 mb-1">Source{record.sourceRows.length > 1 ? `s (${record.sourceRows.length})` : ""}</div>
          {record.sourceRows.map((o) => (
            <div key={`${o.fileId}-${o.rowNumber}`} className="text-slate-800 break-all">
              {o.filename} <span className="text-slate-400">· row {o.rowNumber}</span>
            </div>
          ))}
        </div>
        {onOpenSession && (
          <button
            onClick={() => onOpenSession(record.sessionRecordId)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Open raw session <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

/* `focusQaId` opens the view on one record — searched for and expanded —
 * when the user follows a QA ID from a consolidated question. */
export default function ExtractedQA({ records, sessions, summary, onGoImport, focusQaId = null, onOpenSession }) {
  const [filters, setFilters] = useState(() => (focusQaId ? { ...DEFAULT_QA_FILTERS, text: focusQaId } : DEFAULT_QA_FILTERS));
  const [sort, setSort] = useState({ key: "id", direction: "asc" });
  const [expanded, setExpanded] = useState(() => new Set(focusQaId ? [focusQaId] : []));
  const [showIds, setShowIds] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const sourceFiles = useMemo(() => facetValues(sessions, "sourceFile"), [sessions]);
  const rows = useMemo(() => sortQA(filterQA(records, filters), sort.key, sort.direction), [records, filters, sort]);

  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setLimit(PAGE); };
  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const sortBy = (key) => setSort((s) => ({ key, direction: s.key === key && s.direction === "asc" ? "desc" : "asc" }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_QA_FILTERS);
  const cols = showIds ? 8 : 7;

  const Th = ({ k, children, className = "" }) => (
    <th className={`px-2 py-2 font-medium ${className}`}>
      {k ? (
        <button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800">
          {children}
          {sort.key === k && (sort.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      ) : children}
    </th>
  );

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No sessions imported yet.
        <div className="mt-3">
          <button onClick={onGoImport} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import responses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-800">Extracted Q&amp;A</h1>
            <LayerBadge layer={LAYER_RAW} />
          </div>
          <span className="text-xs text-slate-500">
            {summary.records} questions from {summary.sessionsWithQuestions} sessions · {summary.multiQuestionSessions} with several questions
            {summary.parseMismatches > 0 && <span className="text-amber-700"> · {summary.parseMismatches} parse mismatch{summary.parseMismatches > 1 ? "es" : ""}</span>}
          </span>
        </div>

        {/* Status counts double as filters. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => set({ answerStatus: "" })}
            className={"rounded-full border px-2.5 py-1 text-xs " + (!filters.answerStatus ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50")}
          >
            All <span className="tabular-nums">{summary.records}</span>
          </button>
          {Object.values(ANSWER_STATUS).map((st) => (
            <button
              key={st}
              onClick={() => set({ answerStatus: filters.answerStatus === st ? "" : st })}
              className={"rounded-full border px-2.5 py-1 text-xs " + (filters.answerStatus === st ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50")}
            >
              {STATUS_STYLE[st].label} <span className="tabular-nums">{summary.byStatus[st]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input
              value={filters.text}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="Search questions and answers…"
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm"
            />
          </label>
          <select
            value={filters.sourceFile} onChange={(e) => set({ sourceFile: e.target.value })} aria-label="Source file"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="">All source files</option>
            {sourceFiles.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={filters.hideConversational} onChange={(e) => set({ hideConversational: e.target.checked })} />
            Hide conversational ({summary.conversational})
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={filters.reviewOnly} onChange={(e) => set({ reviewOnly: e.target.checked })} />
            Needs review ({summary.requiresReview})
          </label>
          {summary.sessionsWithParseIssues > 0 && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={filters.parseIssuesOnly} onChange={(e) => set({ parseIssuesOnly: e.target.checked })} />
              Parse issues ({summary.sessionsWithParseIssues} sessions)
            </label>
          )}
          {filtered && <button onClick={() => set(DEFAULT_QA_FILTERS)} className="text-xs text-slate-500 hover:text-slate-800 underline">Reset</button>}
          <button
            onClick={() => setShowIds((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            title="Session IDs are hidden by default and shown for traceability review."
          >
            {showIds ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showIds ? "Hide session IDs" : "Show session IDs"}
          </button>
        </div>
        <div className="text-xs text-slate-500">Showing {Math.min(limit, rows.length)} of {rows.length}{filtered ? ` matching (${records.length} total)` : ""}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              <Th k="id">QA ID</Th>
              {showIds && <Th>Session ID</Th>}
              <Th k="timestamp" className="whitespace-nowrap">Timestamp</Th>
              <Th k="question">User question</Th>
              <Th>Answer</Th>
              <Th k="answerStatus">Status</Th>
              <Th className="pr-4">Source file</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const open = expanded.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <tr onClick={() => toggle(r.id)} className="border-b border-slate-50 align-top cursor-pointer hover:bg-slate-50">
                    <td className="pl-3 py-2 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{r.id}</td>
                    {showIds && <td className="px-2 py-2 font-mono text-xs text-slate-600 break-all">{r.sessionId || "—"}</td>}
                    <td className="px-2 py-2 whitespace-nowrap text-slate-600">{formatUtc(r.timestamp, r.timestampRaw)}</td>
                    <td className="px-2 py-2 text-slate-800 min-w-[11rem]">{r.question}</td>
                    <td className="px-2 py-2 text-xs text-slate-600 min-w-[18rem]">
                      {r.answerParts.length === 0 && <span className="text-slate-400">— no agent reply</span>}
                      {r.answerParts.map((p, i) => (
                        <div key={p.turnNumber} className={i ? "mt-1.5" : ""}>
                          {r.answerParts.length > 1 && <span className="font-semibold text-slate-500">Part {i + 1} · </span>}
                          {p.kind === PART_KIND.TRUNCATED && <Scissors className="inline h-3 w-3 mr-1 text-amber-600 -mt-0.5" aria-label="truncated" />}
                          <span className={p.kind === PART_KIND.UNAVAILABLE ? "text-slate-400 italic" : ""}>{preview(p.text)}</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={r.answerStatus} />
                      {r.questionKind === "CONVERSATIONAL" && <div className="mt-1 text-[11px] text-slate-500 whitespace-nowrap">conversational</div>}
                      {r.parseStatus !== PARSE_STATUS.OK && <div className="mt-1"><FlagBadge tone="amber">{r.parseStatus}</FlagBadge></div>}
                    </td>
                    <td className="px-2 py-2 pr-4 text-xs text-slate-500 break-all min-w-[9rem]">{r.sourceFiles[0]}{r.sourceFiles.length > 1 && <span className="text-slate-400"> +{r.sourceFiles.length - 1}</span>}</td>
                  </tr>
                  {open && <tr><td colSpan={cols} className="p-0"><Detail record={r} session={sessionById.get(r.sessionRecordId)} onOpenSession={onOpenSession} /></td></tr>}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={cols} className="p-6 text-center text-sm text-slate-400">
                {records.length === 0 ? "No user questions in the imported transcripts." : "No questions match these filters."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="border-t border-slate-100 p-3 text-center">
          <button onClick={() => setLimit((n) => n + PAGE)} className="text-sm text-slate-600 hover:text-slate-900 underline">
            Show {Math.min(PAGE, rows.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}
