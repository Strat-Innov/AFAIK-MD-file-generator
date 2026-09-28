import React, { useRef, useState } from "react";
import {
  Upload, Loader2, ShieldCheck, Trash2, ArrowRight, CheckCircle2, AlertTriangle, XCircle, Copy, Circle,
} from "lucide-react";
import { ACCEPT_ATTRIBUTE, FILE_STATUS, summarize } from "../../lib/responses/importSessions";
import { Stat, FlagBadge } from "./common";

/* The workflow, always visible so no stage is hidden. `ready` marks the
 * stages this build provides; the rest are shown as not yet available
 * rather than left out, so the path from import to export stays clear. */
const STEPS = [
  { n: 1, label: "Import", ready: true },
  { n: 2, label: "Extract Q&A", ready: true },
  { n: 3, label: "Review raw Q&A", ready: true },
  { n: 4, label: "AI consolidate", ready: false },
  { n: 5, label: "Review knowledge", ready: false },
  { n: 6, label: "Export", ready: false },
];

function Workflow({ imported, extracted }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {STEPS.map((s, i) => {
        // Extraction runs on import. Review is never "done" on the app's
        // say-so, so step 3 stays open.
        const done = (s.n === 1 && imported) || (s.n === 2 && extracted);
        return (
          <React.Fragment key={s.n}>
            <li
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 " +
                (done ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : s.ready ? "border-slate-300 bg-white text-slate-700"
                  : "border-dashed border-slate-200 bg-slate-50 text-slate-400")
              }
              title={s.ready ? undefined : "Not available in this version yet"}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              <span className="font-semibold">{s.n}</span> {s.label}
            </li>
            {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-slate-300" />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

const STATUS_BADGE = {
  [FILE_STATUS.IMPORTED]: { tone: "emerald", Icon: CheckCircle2, label: "Imported" },
  [FILE_STATUS.DUPLICATE_FILE]: { tone: "slate", Icon: Copy, label: "Already imported" },
  [FILE_STATUS.REJECTED]: { tone: "rose", Icon: XCircle, label: "Not imported" },
};

function FileTable({ files }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-2 py-2 font-medium">Type</th>
            <th className="px-2 py-2 font-medium text-right">Rows</th>
            <th className="px-2 py-2 font-medium text-right">New sessions</th>
            <th className="px-2 py-2 font-medium text-right">Already seen</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const { tone, Icon, label } = STATUS_BADGE[f.status];
            const notes = [
              f.message,
              ...f.warnings,
              f.status === FILE_STATUS.IMPORTED && f.unmappedHeaders.length ? `Extra columns kept as-is: ${f.unmappedHeaders.join(", ")}` : "",
              f.status === FILE_STATUS.IMPORTED && f.missingFields.length ? `Columns not in this file: ${f.missingFields.join(", ")}` : "",
            ].filter(Boolean);
            return (
              <tr key={f.id} className="border-b border-slate-50 align-top last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-800 break-all">{f.filename}</div>
                  {notes.map((n) => <div key={n} className="text-xs text-slate-500 mt-0.5">{n}</div>)}
                </td>
                <td className="px-2 py-2 text-slate-500">{f.fileType}</td>
                <td className="px-2 py-2 text-right tabular-nums">{f.status === FILE_STATUS.IMPORTED ? f.rowCount : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{f.status === FILE_STATUS.IMPORTED ? f.sessionsAdded : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{f.status === FILE_STATUS.IMPORTED ? f.sessionsMerged : "—"}</td>
                <td className="px-4 py-2">
                  <FlagBadge tone={tone}><Icon className="inline h-3 w-3 mr-1 -mt-0.5" />{label}</FlagBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ResponseImport({ workspace, qaSummary, busy, error, onImport, onClear, onViewRaw, onViewQA }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const summary = summarize(workspace);
  const hasFiles = workspace.files.length > 0;

  const clear = () => {
    if (window.confirm("Clear the imported sessions from this workspace? Your original files are not affected, but anything not exported is lost.")) onClear();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <h1 className="text-lg font-semibold text-slate-900">Response Consolidator</h1>
        <p className="text-sm text-slate-600 mt-1">
          Analyze AFAIK Agent sessions and turn real user questions and responses into reusable knowledge.
        </p>
        <div className="mt-4"><Workflow imported={summary.sessions > 0} extracted={qaSummary.records > 0} /></div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-px" />
          <span>
            Files are read in this browser only. Nothing is uploaded, saved, or sent to an AI service.
            Imported sessions are kept as exported and are never rewritten. Closing or reloading the tab discards the
            workspace, so export anything you need to keep.
          </span>
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy && e.dataTransfer.files.length) onImport(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={
          "rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors " +
          (dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white hover:bg-slate-50")
        }
      >
        {busy ? <Loader2 className="h-6 w-6 mx-auto text-slate-400 mb-1 animate-spin" /> : <Upload className="h-6 w-6 mx-auto text-slate-400 mb-1" />}
        <div className="text-sm font-medium text-slate-700">
          {busy ? "Reading files…" : "Drop CSV / XLSX session exports here"}
        </div>
        <div className="text-xs text-slate-500 mt-1">Supported: CSV • XLSX · several files at once</div>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Browse files
        </button>
        <input
          ref={inputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="hidden"
          onChange={(e) => { if (e.target.files.length) onImport(e.target.files); e.target.value = ""; }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {hasFiles && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <span className="text-sm font-semibold text-slate-800">Import summary</span>
            <div className="flex items-center gap-2">
              <button onClick={clear} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                <Trash2 className="h-3.5 w-3.5" /> Clear workspace
              </button>
              <button
                onClick={onViewRaw}
                disabled={summary.sessions === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                View raw sessions
              </button>
              <button
                onClick={onViewQA}
                disabled={qaSummary.records === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Review extracted Q&amp;A <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 p-4">
            <Stat label="Files imported" value={summary.files} />
            <Stat label="Sessions" value={summary.sessions} />
            <Stat label="Q&A pairs (user questions)" value={qaSummary.records} />
            <Stat label="Q&A needing review" value={qaSummary.requiresReview} tone={qaSummary.requiresReview ? "amber" : "slate"} />
            <Stat label="Rows read" value={summary.rows} />
            <Stat label="Sessions in >1 file" value={summary.multiSourceSessions} />
            <Stat label="Conflicting session IDs" value={summary.conflicts} tone={summary.conflicts ? "amber" : "slate"} />
            <Stat label="Files skipped" value={summary.filesSkipped} tone={summary.filesSkipped ? "rose" : "slate"} />
          </div>
          <FileTable files={workspace.files} />
        </div>
      )}
    </div>
  );
}
