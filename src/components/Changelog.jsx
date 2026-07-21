import React, { useMemo, useState } from "react";
import { Search, ChevronLeft, Download, Trash2, FileCode } from "lucide-react";
import { searchEntries, deleteEntry, renameEntry } from "../lib/history";

function dateLabel(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function download(entry) {
  const blob = new Blob([entry.md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entry.title.replace(/[^\w.-]+/g, "_")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function EntryDetail({ entry, onBack, onChanged }) {
  const [title, setTitle] = useState(entry.title);

  const commitTitle = () => {
    const next = title.trim() || entry.title;
    setTitle(next);
    if (next !== entry.title) {
      renameEntry(entry.id, next);
      onChanged();
    }
  };

  const remove = () => {
    deleteEntry(entry.id);
    onChanged();
    onBack();
  };

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3">
        <ChevronLeft className="h-4 w-4" /> Back to changelog
      </button>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            className="w-full text-lg font-semibold text-slate-800 outline-none focus:border-b focus:border-emerald-400"
          />
          <div className="mt-1 text-xs text-slate-400">
            {dateLabel(entry.createdAt)} · {entry.count} file{entry.count !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Included files</div>
          <div className="max-h-32 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-xs font-mono text-slate-600" style={{ lineHeight: "1.6" }}>
            {entry.names.map((n) => <div key={n}>{n}</div>)}
          </div>

          <div className="text-xs uppercase tracking-wide text-slate-400 mt-4 mb-2">Preview</div>
          <pre className="max-h-64 overflow-auto rounded border border-slate-100 bg-slate-900 p-3 text-xs text-slate-100" style={{ whiteSpace: "pre-wrap" }}>
            {entry.md.slice(0, 2500)}
            {entry.md.length > 2500 ? "\n…" : ""}
          </pre>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => download(entry)} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700">
              <Download className="h-4 w-4" /> Download .md
            </button>
            <button onClick={remove} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 text-rose-600 text-sm px-3.5 py-2 hover:bg-rose-50">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Changelog({ refreshKey, onChanged }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => searchEntries(query), [query, refreshKey]);
  const selected = selectedId ? entries.find((e) => e.id === selectedId) : null;

  if (selected) {
    return <EntryDetail entry={selected} onBack={() => setSelectedId(null)} onChanged={onChanged} />;
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search changelog…"
          className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {query ? "No entries match that search." : "No generated files yet — convert something to see it here."}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50"
            >
              <FileCode className="h-4 w-4 text-emerald-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800 truncate">{e.title}</div>
                <div className="text-xs text-slate-400">{dateLabel(e.createdAt)} · {e.count} file{e.count !== 1 ? "s" : ""}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
