import React, { useState } from "react";
import { Trash2, Plus, X } from "lucide-react";
import * as tagsLib from "../lib/tags";
import { renameTagEverywhere, clearTagEverywhere, listMemory, rememberTag, forgetTag } from "../lib/memory";

export default function TagManager({ tags, onRename, onRemove, onAdd }) {
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState(() => Object.fromEntries(tags.map((t) => [t, t])));
  const [newTag, setNewTag] = useState("");
  const [memoryKey, setMemoryKey] = useState(0);
  const memory = listMemory();

  const commitRename = (oldName) => {
    setError("");
    const next = (drafts[oldName] ?? oldName).trim();
    if (next === oldName) return;
    try {
      tagsLib.renameTag(oldName, next);
      renameTagEverywhere(oldName, next);
      onRename(oldName, next);
      setMemoryKey((k) => k + 1);
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
      setMemoryKey((k) => k + 1);
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

  const changeMemoryTag = (filename, tag) => {
    rememberTag(filename, tag);
    setMemoryKey((k) => k + 1);
  };

  const deleteMemoryEntry = (filename) => {
    forgetTag(filename);
    setMemoryKey((k) => k + 1);
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

      <div className="mt-6 pt-4 border-t border-slate-100">
        <div className="text-sm font-semibold text-slate-800 mb-1">Memory Log</div>
        <p className="text-xs text-slate-500 mb-3">
          Every filename the app has learned to auto-sort. Edit or delete an entry if it's remembering the wrong bucket.
        </p>
        {memory.length === 0 ? (
          <div className="text-sm text-slate-400">Nothing remembered yet.</div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
            {memory.map(({ filename, tag }) => (
              <div key={filename} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-slate-600 truncate flex-1">{filename}</span>
                <select
                  value={tags.includes(tag) ? tag : ""}
                  onChange={(e) => changeMemoryTag(filename, e.target.value)}
                  className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white shrink-0"
                >
                  {!tags.includes(tag) && <option value="" disabled>{tag} (removed)</option>}
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => deleteMemoryEntry(filename)} title="Forget this mapping" className="shrink-0 rounded-md p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
