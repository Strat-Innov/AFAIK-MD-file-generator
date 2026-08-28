import React from "react";
import { Download, FolderTree, Inbox, X, Plus, Minus, History, ExternalLink, ShieldCheck, ShieldAlert } from "lucide-react";
import { UNSORTED } from "../lib/router";
import { isVisible } from "../lib/webpartVisibility";
import { formatBucketReport } from "../lib/generate";

function download(bucket, md, suffix) {
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bucket.replace(/[^\w.-]+/g, "_")}_${suffix}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function sizeLabel(md) {
  const bytes = new Blob([md]).size;
  return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

// Shared between the live preview and the highlights panel — both show
// the same shape of data (fileVersionChanges), just from different
// sources, and both respect the visibility toggle from Manage Tags.
function ChangeList({ fileVersionChanges }) {
  const visibleEntries = fileVersionChanges
    .map((fv) => ({ ...fv, changes: fv.changes.filter((c) => isVisible(c.type)) }))
    .filter((fv) => fv.changes.length > 0);

  if (visibleEntries.length === 0) {
    return <div className="text-sm text-slate-400">Nothing to show with the current highlight settings.</div>;
  }

  return (
    <div className="space-y-3">
      {visibleEntries.map((fv) => (
        <div key={fv.filename} className="rounded-lg border border-slate-100 p-3">
          <div className="text-xs font-semibold text-slate-700 mb-2">
            {fv.filename} <span className="text-slate-400 font-normal">— Version {fv.version}</span>
          </div>
          {fv.changes.map((c) => (
            <div key={c.label} className="mb-2 last:mb-0">
              <div className="text-xs font-medium text-slate-500 mb-1">{c.label}</div>
              {c.kind === "list" && c.added.map((item) => (
                <div key={`add-${item.key}`} className="flex items-start gap-1.5 text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1 mb-1">
                  <Plus className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{item.label}</span>
                </div>
              ))}
              {c.kind === "list" && c.removed.map((item) => (
                <div key={`rem-${item.key}`} className="flex items-start gap-1.5 text-xs text-rose-700 bg-rose-50 rounded px-2 py-1 mb-1">
                  <Minus className="h-3 w-3 mt-0.5 shrink-0" />
                  <span className="line-through">{item.label}</span>
                </div>
              ))}
              {c.kind === "fields" && c.fieldChanges.map((fc) => (
                <div key={fc.field} className="text-xs text-slate-700 bg-slate-50 rounded px-2 py-1 mb-1">
                  <span className="font-medium">{fc.field}:</span>{" "}
                  {fc.from == null ? <span className="text-emerald-700">{fc.to} (New)</span> : (
                    <>
                      <span className="text-rose-700 line-through">{fc.from}</span>
                      {" → "}
                      <span className="text-emerald-700">{fc.to}</span>
                    </>
                  )}
                </div>
              ))}
              {c.kind === "generic" && (
                <div className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1 mb-1">Content changed (no item-level detail available for this section)</div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// The gate, made inspectable. A FAIL names the values that went missing
// rather than just refusing the download, so the cause is diagnosable
// without opening a console.
function ValidationPanel({ bucket, optimized }) {
  if (!optimized) return null;
  const pass = optimized.status === "PASS";
  const missing = optimized.totals.sourceUnits - optimized.totals.representedUnits;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm mt-4">
      <div className="flex items-center gap-2 border-b border-slate-100 p-4">
        {pass ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />}
        <span className="text-sm font-semibold text-slate-800">AI file validation</span>
        <span className={"ml-auto text-xs font-semibold rounded-full px-2 py-0.5 " + (pass ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
          {optimized.status}
        </span>
      </div>
      <div className="p-4 space-y-1 text-xs text-slate-600">
        <div>Pages: <span className="font-mono">{optimized.pages.length}</span></div>
        <div>Source content units: <span className="font-mono">{optimized.totals.sourceUnits}</span></div>
        <div>Represented content units: <span className="font-mono">{optimized.totals.representedUnits}</span></div>
        <div>Missing units: <span className={"font-mono " + (missing ? "text-rose-700 font-semibold" : "")}>{missing}</span></div>
        <div>Unmatched units: <span className={"font-mono " + (optimized.totals.unmatched ? "text-amber-700 font-semibold" : "")}>{optimized.totals.unmatched}</span></div>
        {!pass && (
          <>
            <p className="pt-2 text-rose-700">
              The AI file is blocked: {optimized.failed.length} page(s) lost meaningful source information. The raw master file is unaffected and still downloadable.
            </p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-rose-100 bg-rose-50 p-2 text-[11px] text-rose-800">
              {formatBucketReport(bucket, optimized)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({ previewChanges }) {
  const hasChanges = previewChanges && previewChanges.length > 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 text-sm font-semibold text-slate-800">Preview of changes</div>
      <div className="p-4">
        {!hasChanges ? <div className="text-sm text-slate-400">No pending content changes this session.</div> : <ChangeList fileVersionChanges={previewChanges} />}
      </div>
    </div>
  );
}

function HighlightsPanel({ latestPublished, onViewDetailed }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm mt-4">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <span className="text-sm font-semibold text-slate-800">Changelog highlights</span>
        <button onClick={onViewDetailed} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          Full detail <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      <div className="p-4">
        {!latestPublished ? (
          <div className="text-sm text-slate-400">Nothing published yet.</div>
        ) : (
          <ChangeList fileVersionChanges={latestPublished.changes} />
        )}
      </div>
    </div>
  );
}

export default function BucketView({ bucket, files, outputs, tags, onReassign, onUnsort, onRemove, latestPublished, onViewDetailed, previewChanges, staleFilenames }) {
  const isUnsorted = bucket === UNSORTED;
  const md = outputs?.master;
  const optimized = outputs?.optimized;
  const staleSet = new Set(staleFilenames || []);
  const sidebar = !isUnsorted && (
    <div className="w-full md:w-80 shrink-0">
      <PreviewPanel previewChanges={previewChanges} />
      <ValidationPanel bucket={bucket} optimized={optimized} />
      <HighlightsPanel latestPublished={latestPublished} onViewDetailed={onViewDetailed} />
    </div>
  );

  if (!files || files.length === 0) {
    return (
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Nothing sorted into <span className="font-semibold">{bucket}</span> yet this session — drop files above.
        </div>
        {sidebar}
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div className="flex items-center gap-2 text-sm min-w-0">
              {isUnsorted ? <Inbox className="h-4 w-4 text-amber-500 shrink-0" /> : <FolderTree className="h-4 w-4 text-emerald-600 shrink-0" />}
              <span className="font-semibold text-slate-800 truncate">{bucket}</span>
              <span className="text-slate-400 shrink-0">
                · {files.length} file{files.length !== 1 ? "s" : ""}
                {md ? ` · raw ${sizeLabel(md)}` : ""}
                {optimized?.status === "PASS" ? ` · AI ${sizeLabel(optimized.md)}` : ""}
              </span>
            </div>
            {!isUnsorted && md && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => download(bucket, md, "Master_File")} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700">
                  <Download className="h-4 w-4" /> Raw .md
                </button>
                <button
                  onClick={() => download(bucket, optimized.md, "AI_File")}
                  disabled={optimized?.status !== "PASS"}
                  title={optimized?.status === "PASS" ? "Retrieval-optimized file for Copilot Studio" : "Blocked: validation found missing source information"}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white text-sm px-3.5 py-2 hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  <Download className="h-4 w-4" /> AI .md
                </button>
              </div>
            )}
          </div>

          <div className="p-4">
            {isUnsorted ? (
              <p className="text-xs text-slate-500 mb-3">
                These didn't match a known folder or a remembered filename. Assign each to a bucket — future drops of the same filename will follow automatically.
              </p>
            ) : (
              <p className="text-xs text-slate-500 mb-3">
                Wrong bucket? Click × to send a file back to Unsorted and forget its remembered tag.
              </p>
            )}
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
              {files.map((f) => (
                <div key={f.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-slate-600 truncate flex items-center gap-2">
                    {f.name}
                    {staleSet.has(f.name) && (
                      <span title="This file's modification time isn't newer than what's already published to GitHub" className="inline-flex items-center gap-1 shrink-0 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5">
                        <History className="h-3 w-3" /> Old version
                      </span>
                    )}
                  </span>
                  {isUnsorted ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && onReassign(f, e.target.value)}
                        className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white"
                      >
                        <option value="" disabled>Assign to…</option>
                        {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => onRemove(f)}
                        title="Discard this file"
                        className="rounded-md p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onUnsort(f)}
                      title="Unsort this file"
                      className="shrink-0 rounded-md p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {sidebar}
    </div>
  );
}
