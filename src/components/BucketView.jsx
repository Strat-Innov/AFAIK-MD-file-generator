import React from "react";
import { Download, FolderTree, Inbox } from "lucide-react";
import { UNSORTED } from "../lib/router";

function download(bucket, md) {
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bucket.replace(/[^\w.-]+/g, "_")}_Master_File.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function sizeLabel(md) {
  const bytes = new Blob([md]).size;
  return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export default function BucketView({ bucket, files, md, tags, onReassign }) {
  const isUnsorted = bucket === UNSORTED;

  if (!files || files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Nothing sorted into <span className="font-semibold">{bucket}</span> yet this session — drop files above.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {isUnsorted ? <Inbox className="h-4 w-4 text-amber-500 shrink-0" /> : <FolderTree className="h-4 w-4 text-emerald-600 shrink-0" />}
          <span className="font-semibold text-slate-800 truncate">{bucket}</span>
          <span className="text-slate-400 shrink-0">· {files.length} file{files.length !== 1 ? "s" : ""}{md ? ` · ${sizeLabel(md)}` : ""}</span>
        </div>
        {!isUnsorted && md && (
          <button onClick={() => download(bucket, md)} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700 shrink-0">
            <Download className="h-4 w-4" /> Download .md
          </button>
        )}
      </div>

      <div className="p-4">
        {isUnsorted && (
          <p className="text-xs text-slate-500 mb-3">
            These didn't match a known folder or a remembered filename. Assign each to a bucket — future drops of the same filename will follow automatically.
          </p>
        )}
        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs text-slate-600 truncate">{f.name}</span>
              {isUnsorted && (
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && onReassign(f, e.target.value)}
                  className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white shrink-0"
                >
                  <option value="" disabled>Assign to…</option>
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
