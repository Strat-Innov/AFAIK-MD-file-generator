import React from "react";
import { FolderTree, Inbox, Settings, List, FlaskConical, ListChecks, Upload, Table2, MessagesSquare, Sparkles } from "lucide-react";
import { UNSORTED } from "../lib/router";
import { RESPONSE_VIEWS, RC_IMPORT, RC_RAW_SESSIONS, RC_EXTRACTED_QA, RC_AI_CONSOLIDATION, LAYER_RAW, LAYER_DERIVED } from "../lib/responses/views";

const RESPONSE_ICONS = { [RC_IMPORT]: Upload, [RC_RAW_SESSIONS]: Table2, [RC_EXTRACTED_QA]: MessagesSquare, [RC_AI_CONSOLIDATION]: Sparkles };

export default function Sidebar({ tags, selected, onSelect, counts, responseCounts = {} }) {
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

  const sectionHeading = (title, subtitle) => (
    <div className="mt-3 mb-1 px-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{title}</div>
      {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
    </div>
  );

  const groupLabel = (text) => (
    <div className="mt-2 mb-1 px-2 text-xs uppercase tracking-wide text-slate-500">{text}</div>
  );

  // Consolidator views grouped by the data layer they show, so the
  // RAW / DERIVED distinction is visible from the navigation itself.
  const responseItem = (v) => item(v.key, v.label, RESPONSE_ICONS[v.key] ?? Table2, responseCounts[v.key]);
  const byLayer = (layer) => RESPONSE_VIEWS.filter((v) => v.layer === layer);

  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-white p-3 flex flex-col gap-1 min-h-screen">
      <div className="px-2 py-2 mb-1">
        <div className="text-sm font-semibold tracking-wide">AFAIK Configuration App</div>
        <div className="text-xs text-slate-400">Knowledge configuration workspace</div>
      </div>

      {sectionHeading("Knowledge Sources", "ASPx → Markdown")}
      {item(UNSORTED, "Unsorted", Inbox, counts[UNSORTED])}

      {groupLabel("Buckets")}
      {tags.map((t) => item(t, t, FolderTree, counts[t]))}

      <div className="mt-2 pt-1 border-t border-slate-800">
        {sectionHeading("Response Consolidator", "AFAIK Agent sessions")}
      </div>
      {byLayer(null).map(responseItem)}
      {byLayer(LAYER_RAW).length > 0 && groupLabel("Raw · source of truth")}
      {byLayer(LAYER_RAW).map(responseItem)}
      {byLayer(LAYER_DERIVED).length > 0 && groupLabel("Derived · AI candidates")}
      {byLayer(LAYER_DERIVED).map(responseItem)}

      <div className="mt-auto pt-2 border-t border-slate-800 flex flex-col gap-1">
        {item("Changelog", "Changelog", List)}
        {item("Benchmark", "Benchmark", FlaskConical)}
        {item("TestQuestions", "Test Questions", ListChecks)}
        {item("ManageTags", "Manage Tags", Settings)}
      </div>
    </aside>
  );
}
