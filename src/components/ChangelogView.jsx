import React from "react";
import { Download, AlertTriangle } from "lucide-react";
import * as log from "../lib/log";

export default function ChangelogView({ refreshKey, onChanged }) {
  const text = log.getLogText();
  const reminder = log.needsYearEndReminder();

  const exportOnly = () => log.exportLog();

  const archiveAndReset = () => {
    log.exportLog();
    log.clearLog();
    onChanged();
  };

  return (
    <div className="space-y-3">
      {reminder && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            This log still has entries from a previous year. Download it to archive, then start fresh for this year.
            <div className="mt-2">
              <button onClick={archiveAndReset} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 text-white text-xs px-3 py-1.5 hover:bg-amber-700">
                <Download className="h-3.5 w-3.5" /> Download & start new year
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <span className="text-sm font-semibold text-slate-800">Changelog (.txt)</span>
          <button
            onClick={exportOnly}
            disabled={!text}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4" /> Export .txt
          </button>
        </div>
        <div className="p-4">
          {text ? (
            <pre className="max-h-96 overflow-auto rounded border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">{text}</pre>
          ) : (
            <div className="text-sm text-slate-400">No activity logged yet — generate something to see it here.</div>
          )}
        </div>
      </div>
    </div>
  );
}
