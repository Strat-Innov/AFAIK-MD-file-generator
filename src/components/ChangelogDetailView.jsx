import React, { useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { fetchChangelogText } from "../lib/github";

export default function ChangelogDetailView({ tags }) {
  const [tag, setTag] = useState(tags[0] || "");
  const [text, setText] = useState(undefined); // undefined = not yet loaded, null = loaded but nothing published, string = content
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (t) => {
    setLoading(true); setError(""); setText(undefined);
    try {
      const content = await fetchChangelogText(t);
      setText(content); // string, or null if nothing published yet
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onTagChange = (t) => {
    setTag(t);
    load(t);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-4 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Changelog (detailed)</span>
          <select
            value={tag}
            onChange={(e) => onTagChange(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
          >
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button
          onClick={() => load(tag)}
          disabled={!tag || loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {text === undefined && !loading && !error ? "Load" : "Refresh"}
        </button>
      </div>

      <div className="p-4">
        <p className="text-xs text-slate-500 mb-3">
          Full published record for this bucket, exactly as committed to GitHub — every web part type, unaffected by
          the highlight toggles in Manage Tags.
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 mb-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {text === undefined && !loading && !error && (
          <div className="text-sm text-slate-400">Click Load to fetch the full changelog for "{tag}".</div>
        )}
        {loading && <div className="text-sm text-slate-400">Loading…</div>}
        {text === null && !loading && <div className="text-sm text-slate-400">Nothing published for "{tag}" yet.</div>}
        {typeof text === "string" && (
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded p-3">{text}</pre>
        )}
      </div>
    </div>
  );
}
