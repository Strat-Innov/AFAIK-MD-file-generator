import React, { useState } from "react";
import { Download, FlaskConical, Loader2, ShieldCheck, ShieldAlert, Check, AlertTriangle } from "lucide-react";
import { buildBenchmarkArtifacts, compareToCanonical, CANONICAL, SNAPSHOT, SNAPSHOT_CLOCK } from "../lib/benchmarkExport";
import { formatBucketReport } from "../lib/generate";

/* ------------------------------------------------------------------ *
 * Admin / developer surface, deliberately outside the normal workflow.
 *
 * The bucket views stay the product: five Master files, one per tag,
 * generated on every drop. This panel exists only to produce the two
 * consolidated artifacts the retrieval benchmark compares, and it does
 * so through the same frozen generator and the same shared recipe the
 * CLI uses (src/lib/benchmarkExport.js), so the file a person downloads
 * here is byte-identical to the one `npm run benchmark:arms` writes.
 * ------------------------------------------------------------------ */

function downloadText(filename, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const sizeLabel = (bytes) =>
  bytes > 1e6 ? (bytes / 1e6).toFixed(2) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

function Field({ label, children, tone }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-44 shrink-0 text-slate-500">{label}</span>
      <span className={"font-mono break-all " + (tone || "text-slate-700")}>{children}</span>
    </div>
  );
}

// Reported, never enforced. Building from a different corpus is a valid
// thing to do; it just is not the run the pre-flight was designed
// against, and that should be visible rather than silent.
function MatchBadge({ ok }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-2 py-0.5">
      <Check className="h-3 w-3" /> matches verified artifact
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5">
      <AlertTriangle className="h-3 w-3" /> differs from verified artifact
    </span>
  );
}

function ArmCard({ title, subtitle, artifact, match, accent, onDownload, disabled, disabledReason }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <button
          onClick={onDownload}
          disabled={disabled}
          title={disabled ? disabledReason : `Download ${artifact.filename}`}
          className={
            "inline-flex shrink-0 items-center gap-2 rounded-lg text-white text-sm px-3.5 py-2 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed " +
            accent
          }
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>
      <div className="space-y-1 p-4">
        <Field label="File">{artifact.filename}</Field>
        <Field label="Size">{sizeLabel(artifact.bytes)} ({artifact.bytes.toLocaleString()} bytes)</Field>
        <Field label="Pages">{artifact.pages}</Field>
        <Field label="SHA-256">{artifact.sha256 || "— not produced"}</Field>
        {artifact.validation && (
          <>
            <Field label="Source units">{artifact.validation.sourceUnits}</Field>
            <Field label="Represented units">{artifact.validation.representedUnits}</Field>
            <Field
              label="Untraceable units"
              tone={artifact.validation.untraceableUnits ? "text-amber-700 font-semibold" : undefined}
            >
              {artifact.validation.untraceableUnits}
            </Field>
          </>
        )}
        {artifact.sha256 && <div className="pt-2"><MatchBadge ok={match} /></div>}
      </div>
    </div>
  );
}

export default function BenchmarkExport({ files }) {
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [built, setBuilt] = useState(null);
  const [error, setError] = useState("");

  const staged = files || [];

  const generate = async () => {
    setState("working");
    setError("");
    setBuilt(null);
    // Let the spinner paint before the synchronous build (parsing and
    // validating 133 pages takes a moment on the main thread).
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await buildBenchmarkArtifacts(staged);
      setBuilt(result);
      setState("done");
    } catch (e) {
      setError(e.message || String(e));
      setState("error");
    }
  };

  const match = built ? compareToCanonical(built) : null;
  const pass = built?.armC.validation.status === "PASS";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <FlaskConical className="h-4 w-4 text-indigo-600" />
          <span className="text-sm font-semibold text-slate-800">Benchmark export</span>
          <span className="ml-auto text-xs text-slate-400">admin · not part of the normal workflow</span>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-slate-500">
            Builds the two consolidated artifacts the retrieval benchmark compares — one Master file and one
            AI-optimized file over the <em>same</em> page set, so the only thing that varies between arms is the
            representation. This does not touch the per-bucket Master files, which stay exactly as they are.
          </p>

          <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <Field label="Snapshot">{SNAPSHOT}</Field>
            <Field label="Snapshot clock">{SNAPSHOT_CLOCK.toISOString()}</Field>
            <Field
              label="Files staged"
              tone={staged.length === CANONICAL.pages ? "text-slate-700" : "text-amber-700 font-semibold"}
            >
              {staged.length} of {CANONICAL.pages}
            </Field>
          </div>

          {staged.length === 0 ? (
            <p className="text-xs text-amber-700">
              Nothing staged this session. Drop the corpus (all {CANONICAL.pages} pages, or the .zip) above first —
              every bucket's files are pooled into one snapshot here, so it does not matter how they sort.
            </p>
          ) : staged.length !== CANONICAL.pages ? (
            <p className="text-xs text-amber-700">
              This will build a valid, deterministic pair of artifacts, but from a different page set than the one the
              pre-flight was verified against — the checksums below will not match.
            </p>
          ) : null}

          <button
            onClick={generate}
            disabled={state === "working" || staged.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            {state === "working" ? "Generating…" : "Generate Benchmark Artifacts"}
          </button>

          {state === "working" && (
            <p className="text-xs text-slate-500">
              Parsing and validating {staged.length} pages — this runs the full gate, same as a bucket download.
            </p>
          )}
          {state === "error" && (
            <p className="text-xs text-rose-700">Generation failed: {error}</p>
          )}
        </div>
      </div>

      {built && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 p-4">
              {pass ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />}
              <span className="text-sm font-semibold text-slate-800">Snapshot</span>
              <span
                className={
                  "ml-auto text-xs font-semibold rounded-full px-2 py-0.5 " +
                  (pass ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")
                }
              >
                {built.armC.validation.status}
              </span>
            </div>
            <div className="space-y-1 p-4">
              <Field label="Generator">{built.generatorVersion}</Field>
              <Field label="Pages">{built.manifest.corpusPages}</Field>
              <Field label="File-set SHA-256">{built.filesSha256}</Field>
              <div className="pt-2 flex items-center gap-2">
                <MatchBadge ok={match.files} />
                <button
                  onClick={() => downloadText("manifest.json", JSON.stringify(built.manifest, null, 2), "application/json")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-2.5 py-1.5 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> manifest.json
                </button>
              </div>
            </div>
          </div>

          <ArmCard
            title="Arm B — Master"
            subtitle="Consolidated master file · the representation the app shipped before this work"
            artifact={built.armB}
            match={match.armB}
            accent="bg-slate-900 hover:bg-slate-700"
            onDownload={() => downloadText(built.armB.filename, built.armB.md)}
          />

          <ArmCard
            title="Arm C — AI Optimized"
            subtitle="Retrieval representation · produced only on a validation PASS"
            artifact={built.armC}
            match={match.armC}
            accent="bg-emerald-600 hover:bg-emerald-500"
            onDownload={() => downloadText(built.armC.filename, built.armC.md)}
            disabled={!pass}
            disabledReason="Blocked: validation found missing or untraceable source information"
          />

          {!pass && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs text-rose-700">
                Arm C is blocked: {built.optimized.failed.length} page(s) did not validate. Arm B is unaffected and
                still downloadable.
              </p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-rose-100 bg-white p-2 text-[11px] text-rose-800">
                {formatBucketReport(built.snapshot, built.optimized)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
