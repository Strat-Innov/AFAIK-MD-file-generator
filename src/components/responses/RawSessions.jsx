import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Search, Eye, EyeOff, Upload } from "lucide-react";
import { LAYER_RAW } from "../../lib/responses/views";
import {
  DEFAULT_FILTERS, RESOLVED_FILTER, facetValues, filterSessions, sortSessions,
} from "../../lib/responses/sessionQuery";
import { SESSION_FLAGS } from "../../lib/responses/importSessions";
import { LayerBadge, FlagBadge, formatUtc } from "./common";

const PAGE = 100;

const FLAG_LABELS = {
  [SESSION_FLAGS.MISSING_SESSION_ID]: "No session ID",
  [SESSION_FLAGS.DUPLICATE_ID_CONFLICT]: "Same ID, different content",
  [SESSION_FLAGS.UNPARSED_TIMESTAMP]: "Date not readable",
};

const preview = (text, n = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
};

function Select({ value, onChange, label, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
      aria-label={label}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Detail({ session, showIds }) {
  const fields = [
    ["Session ID", session.sessionId || "—"],
    ["Start (UTC)", session.timestampRaw || "—"],
    ["Outcome", session.outcome || "—"],
    ["Outcome reason", session.outcomeReason || "—"],
    ["Resolved (implied)", session.resolvedRaw || "—"],
    ["Turns", session.turnsRaw || "—"],
    ["Initial user message", session.initialUserMessage || "—"],
    ["Topic", [session.topicName, session.topicId].filter(Boolean).join(" · ") || "—"],
    ["Channel", session.channel || "—"],
    ["CSAT", session.csat || "—"],
    ["Comments", session.comments || "—"],
    ...Object.entries(session.extra),
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] p-4 bg-slate-50 border-t border-slate-100">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">ChatTranscript — as exported</div>
        <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 font-mono max-h-[32rem] overflow-y-auto">
          {session.transcript || "(empty)"}
        </pre>
      </div>
      <div className="space-y-3 text-xs">
        <dl className="space-y-1.5">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="text-slate-500 mb-1">Source{session.occurrences.length > 1 ? `s (${session.occurrences.length})` : ""}</div>
          {session.occurrences.map((o) => (
            <div key={`${o.fileId}-${o.rowNumber}`} className="text-slate-800 break-all">
              {o.filename} <span className="text-slate-400">· row {o.rowNumber}</span>
            </div>
          ))}
        </div>
        {!showIds && <div className="text-slate-400">Record {session.id}</div>}
      </div>
    </div>
  );
}

/* `focusSessionRecordId` opens the view on one session — searched for by
 * its SessionId and expanded — when the user follows a Q&A record back
 * to its source. */
export default function RawSessions({ workspace, onGoImport, focusSessionRecordId = null }) {
  const sessions = workspace.sessions;
  const focus = focusSessionRecordId ? sessions.find((s) => s.id === focusSessionRecordId) : null;
  const [filters, setFilters] = useState(() => (focus?.sessionId ? { ...DEFAULT_FILTERS, text: focus.sessionId } : DEFAULT_FILTERS));
  const [sort, setSort] = useState({ key: "timestamp", direction: "desc" });
  const [expanded, setExpanded] = useState(() => new Set(focus ? [focus.id] : []));
  const [showIds, setShowIds] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const facets = useMemo(() => ({
    channel: facetValues(sessions, "channel"),
    outcome: facetValues(sessions, "outcome"),
    sourceFile: facetValues(sessions, "sourceFile"),
  }), [sessions]);

  const rows = useMemo(
    () => sortSessions(filterSessions(sessions, filters), sort.key, sort.direction),
    [sessions, filters, sort],
  );

  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setLimit(PAGE); };
  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const sortBy = (key) => setSort((s) => ({ key, direction: s.key === key && s.direction === "desc" ? "asc" : "desc" }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

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
            <h1 className="text-sm font-semibold text-slate-800">Raw Sessions</h1>
            <LayerBadge layer={LAYER_RAW} note="read-only, exactly as exported" />
          </div>
          <span className="text-xs text-slate-500">
            Showing {Math.min(limit, rows.length)} of {rows.length}{filtered ? ` matching (${sessions.length} total)` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input
              value={filters.text}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="Search questions, transcripts, topics…"
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm"
            />
          </label>
          <input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} aria-label="From date (UTC)" className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} aria-label="To date (UTC)" className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-700" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Channel" value={filters.channel} onChange={(v) => set({ channel: v })} options={[["", "All channels"], ...facets.channel.map((c) => [c, c])]} />
          <Select label="Outcome" value={filters.outcome} onChange={(v) => set({ outcome: v })} options={[["", "All outcomes"], ...facets.outcome.map((c) => [c, c])]} />
          <Select
            label="Resolution" value={filters.resolved} onChange={(v) => set({ resolved: v })}
            options={[[RESOLVED_FILTER.ALL, "Resolved + unresolved"], [RESOLVED_FILTER.RESOLVED, "Resolved"], [RESOLVED_FILTER.UNRESOLVED, "Unresolved"], [RESOLVED_FILTER.UNKNOWN, "Resolution unknown"]]}
          />
          <Select label="Source file" value={filters.sourceFile} onChange={(v) => set({ sourceFile: v })} options={[["", "All source files"], ...facets.sourceFile.map((c) => [c, c])]} />
          {filtered && (
            <button onClick={() => set(DEFAULT_FILTERS)} className="text-xs text-slate-500 hover:text-slate-800 underline">Reset filters</button>
          )}
          <button
            onClick={() => setShowIds((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            title="Session IDs are hidden by default and shown for traceability review."
          >
            {showIds ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showIds ? "Hide session IDs" : "Show session IDs"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-8" />
              {showIds && <Th>Session ID</Th>}
              <Th k="timestamp" className="whitespace-nowrap">Date / time</Th>
              <Th k="question">Initial user question</Th>
              <Th>Transcript</Th>
              <Th k="outcome">Outcome</Th>
              <Th k="channel">Channel</Th>
              <Th k="csat">CSAT</Th>
              <Th k="sourceFile" className="pr-4">Source file</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((s) => {
              const open = expanded.has(s.id);
              return (
                <React.Fragment key={s.id}>
                  <tr onClick={() => toggle(s.id)} className="border-b border-slate-50 align-top cursor-pointer hover:bg-slate-50">
                    <td className="pl-3 py-2 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    {showIds && <td className="px-2 py-2 font-mono text-xs text-slate-600 break-all">{s.sessionId || "—"}</td>}
                    <td className="px-2 py-2 whitespace-nowrap text-slate-600">{formatUtc(s.timestamp, s.timestampRaw)}</td>
                    <td className="px-2 py-2 text-slate-800 min-w-[10rem]">
                      {s.initialUserMessage || <span className="text-slate-400">—</span>}
                      {s.flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">{s.flags.map((f) => <FlagBadge key={f}>{FLAG_LABELS[f] ?? f}</FlagBadge>)}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500 min-w-[16rem]">{preview(s.transcript) || "—"}</td>
                    <td className="px-2 py-2 text-slate-700">
                      {s.outcome || "—"}
                      {s.outcomeReason && <div className="text-xs text-slate-400">{s.outcomeReason}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{s.channel || "—"}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-700">{s.csat || "—"}</td>
                    <td className="px-2 py-2 pr-4 text-xs text-slate-500 break-all min-w-[9rem]">
                      {s.occurrences[0].filename}
                      {s.occurrences.length > 1 && <span className="text-slate-400"> +{s.occurrences.length - 1}</span>}
                    </td>
                  </tr>
                  {open && (
                    <tr><td colSpan={showIds ? 9 : 8} className="p-0"><Detail session={s} showIds={showIds} /></td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={showIds ? 9 : 8} className="p-6 text-center text-sm text-slate-400">No sessions match these filters.</td></tr>
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
