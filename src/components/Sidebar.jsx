import React from "react";
import { FolderTree, Inbox, Settings } from "lucide-react";
import { UNSORTED } from "../lib/router";

export default function Sidebar({ tags, selected, onSelect, counts }) {
  const item = (key, label, Icon, badge) => (
    <button
      key={key}
      onClick={() => onSelect(key)}
      className={
        "w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors " +
        (selected === key ? "bg-slate-700 text-white font-medium" : "text-slate-300 hover:bg-slate-800 hover:text-white")
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate flex-1">{label}</span>
      {!!badge && <span className="text-xs rounded-full bg-emerald-500 text-slate-900 font-semibold px-1.5 py-0.5">{badge}</span>}
    </button>
  );

  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-white p-3 flex flex-col gap-1 min-h-screen">
      <div className="px-2 py-2 mb-1">
        <div className="text-sm font-semibold tracking-wide">ASPx → Markdown</div>
        <div className="text-xs text-slate-400">Master File Generator</div>
      </div>

      {item(UNSORTED, "Unsorted", Inbox, counts[UNSORTED])}

      <div className="mt-2 mb-1 px-2 text-xs uppercase tracking-wide text-slate-500">Buckets</div>
      {tags.map((t) => item(t, t, FolderTree, counts[t]))}

      <div className="mt-auto pt-2 border-t border-slate-800 flex flex-col gap-1">
        {item("ManageTags", "Manage Tags", Settings)}
      </div>
    </aside>
  );
}
