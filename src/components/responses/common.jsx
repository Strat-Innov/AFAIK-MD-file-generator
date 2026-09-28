import React from "react";
import { Database, Sparkles } from "lucide-react";
import { LAYER_RAW } from "../../lib/responses/views";

/* Every Consolidator view states which layer it shows. RAW is the
 * source of truth; DERIVED is an AI candidate. The badge is the same
 * everywhere so the distinction reads at a glance. */
export function LayerBadge({ layer, note }) {
  const raw = layer === LAYER_RAW;
  const Icon = raw ? Database : Sparkles;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold " +
        (raw ? "border-slate-300 bg-slate-100 text-slate-700" : "border-violet-200 bg-violet-50 text-violet-700")
      }
      title={raw ? "Imported data, exactly as exported. Read-only." : "AI-generated candidate derived from raw data."}
    >
      <Icon className="h-3 w-3" />
      {raw ? "RAW" : "DERIVED"}
      {note && <span className="font-normal">· {note}</span>}
    </span>
  );
}

export function Stat({ label, value, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    amber: "text-amber-700",
    rose: "text-rose-700",
    emerald: "text-emerald-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function FlagBadge({ children, tone = "amber" }) {
  const tones = {
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/* Timestamps are UTC by export convention and are shown as UTC, so the
 * screen never disagrees with the file. Unreadable values show as
 * exported. */
export function formatUtc(iso, raw) {
  if (!iso) return raw || "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
