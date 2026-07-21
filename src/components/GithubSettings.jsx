import React, { useState } from "react";
import { Github, Check } from "lucide-react";
import { getToken, setToken, hasToken } from "../lib/github";

export default function GithubSettings() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(hasToken());

  const save = () => {
    setToken(value);
    setSaved(hasToken());
    setValue("");
  };

  const clear = () => {
    setToken("");
    setSaved(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 mb-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 mb-1">
        <Github className="h-4 w-4" /> GitHub Publishing
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Used to push each bucket's changelog to <span className="font-mono">changelogs/</span> in this repo whenever a
        generation differs from the last one. Stored in this browser only — revoke it on GitHub if you stop using this.
      </p>

      {saved ? (
        <div className="flex items-center gap-2 text-xs text-emerald-700 mb-2">
          <Check className="h-3.5 w-3.5" /> A token is saved.
          <button onClick={clear} className="ml-auto rounded-md border border-rose-200 text-rose-600 text-xs px-2.5 py-1 hover:bg-rose-50">
            Clear token
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="github_pat_…"
            className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400"
          />
          <button onClick={save} disabled={!value.trim()} className="rounded-md bg-slate-900 text-white text-xs px-3 py-1.5 hover:bg-slate-700 disabled:opacity-40 shrink-0">
            Save
          </button>
        </div>
      )}
    </div>
  );
}
