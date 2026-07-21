import React, { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import * as tagsLib from "../lib/tags";
import { renameTagEverywhere, clearTagEverywhere } from "../lib/memory";

export default function TagManager({ tags, onRename, onRemove, onAdd }) {
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState(() => Object.fromEntries(tags.map((t) => [t, t])));
  const [newTag, setNewTag] = useState("");

  const commitRename = (oldName) => {
    setError("");
    const next = (drafts[oldName] ?? oldName).trim();
    if (next === oldName) return;
    try {
      tagsLib.renameTag(oldName, next);
      renameTagEverywhere(oldName, next);
      onRename(oldName, next);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = (name) => {
    setError("");
    try {
      tagsLib.removeTag(name);
      clearTagEverywhere(name);
      onRemove(name);
    } catch (e) {
      setError(e.message);
    }
  };

  const add = () => {
    setError("");
    try {
      tagsLib.addTag(newTag);
      onAdd(newTag.trim());
      setNewTag("");
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="text-sm font-semibold text-slate-800 mb-1">Manage Tags</div>
      <p className="text-xs text-slate-500 mb-3">
        Renaming carries over any filenames already remembered under that tag. Removing a tag doesn't delete files —
        anything remembered under it falls back to Unsorted.
      </p>

      {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

      <div className="space-y-2 mb-4">
        {tags.map((t) => (
          <div key={t} className="flex items-center gap-2">
            <input
              value={drafts[t] ?? t}
              onChange={(e) => setDrafts((d) => ({ ...d, [t]: e.target.value }))}
              onBlur={() => commitRename(t)}
              className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400"
            />
            <button onClick={() => remove(t)} className="inline-flex items-center gap-1 rounded-md border border-rose-200 text-rose-600 text-xs px-2.5 py-1.5 hover:bg-rose-50 shrink-0">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New tag name…"
          className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400"
        />
        <button onClick={add} className="inline-flex items-center gap-1 rounded-md bg-slate-900 text-white text-xs px-2.5 py-1.5 hover:bg-slate-700 shrink-0">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );
}
