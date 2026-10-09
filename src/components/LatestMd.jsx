import React, { useState, useEffect } from "react";
import { FileText, Download, Loader2, RefreshCw, ShieldAlert, Package } from "lucide-react";
import { buildBenchmarkArtifacts } from "../lib/benchmarkExport";
import { createZip } from "../lib/zip";
import { saveBlob, saveText, sizeLabel } from "../lib/download";
import { stagedKey } from "../lib/stagedKey";

/* ------------------------------------------------------------------ *
 * LATEST MD — the whole corpus as two files, and nothing else.
 *
 * The bucket views already export per-bucket Master and AI files, and
 * the benchmark workspace already produces the consolidated pair. But
 * the consolidated pair only existed in there, surrounded by snapshot
 * identity, arm definitions, coverage gates and canonical comparison —
 * all of which matter when running a controlled experiment and none of
 * which matter when the question is just "pages changed at source, give
 * me the current files".
 *
 * So this is the same two artifacts with the experiment removed. It is
 * deliberately NOT a second implementation: it calls the same
 * buildBenchmarkArtifacts() the benchmark panel calls, and it reads and
 * writes the same current build, so generating in either place is
 * generating the same thing, and the bytes cannot drift between them.
 * ------------------------------------------------------------------ */

function Row({ label, children, mono = true }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-xs">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      <span className={"text-slate-700 break-all" + (mono ? " font-mono" : "")}>{children}</span>
    </div>
  );
}

function FileCard({ title, subtitle, artifact, accent, onDownload, blockedReason }) {
  const produced = Boolean(artifact?.sha256);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <button
          onClick={onDownload}
          disabled={!produced}
          title={produced ? `Download ${artifact.filename}` : blockedReason}
          className={
            "inline-flex shrink-0 items-center gap-2 rounded-lg text-white text-sm px-3.5 py-2 " +
            "disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed " + accent
          }
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>
      <div className="p-4">
        <Row label="File" mono>{produced ? artifact.filename : "—"}</Row>
        <Row label="Size">{produced ? `${sizeLabel(artifact.bytes)} · ${artifact.bytes.toLocaleString()} bytes` : "—"}</Row>
        <Row label="Pages">{produced ? artifact.pages : "—"}</Row>
        <Row label="SHA-256">{produced ? artifact.sha256 : "—"}</Row>
        {!produced && blockedReason && (
          <p className="mt-2 text-xs text-rose-700">{blockedReason}</p>
        )}
      </div>
    </div>
  );
}

export default function LatestMd({ files, currentBuild, onBuild }) {
  const [state, setState] = useState("idle");       // idle | working | error
  const [error, setError] = useState("");
  const [zipping, setZipping] = useState(false);
  const [localBuild, setLocalBuild] = useState(null);

  /* The same build the benchmark panel uses, so the two tabs can never
   * show different bytes for the same corpus. */
  const built = onBuild ? currentBuild : localBuild;
  const setBuilt = onBuild ?? setLocalBuild;

  const staged = files || [];
  const signature = stagedKey(staged);
  const stale = Boolean(built) && built.signature !== signature;

  useEffect(() => { if (state === "error") setError(""); }, [signature]);   // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setState("working");
    setError("");
    setBuilt(null);
    await new Promise((r) => setTimeout(r, 0));     // let the spinner paint
    try {
      const result = await buildBenchmarkArtifacts(staged);
      setBuilt({ ...result, signature: stagedKey(staged) });
      setState("idle");
    } catch (e) {
      setError(e.message || String(e));
      setState("error");
    }
  };

  const downloadBoth = async () => {
    setZipping(true);
    try {
      const entries = [{ name: built.armB.filename, text: built.armB.md }];
      if (built.armC.sha256) entries.push({ name: built.armC.filename, text: built.armC.md });
      const zip = await createZip(entries, { modifiedAt: new Date(built.manifest.snapshotClock) });
      saveBlob(`${built.snapshot}_Master_File.zip`, new Blob([zip], { type: "application/zip" }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setZipping(false);
    }
  };

  const pass = built?.optimized?.status === "PASS";
  const coverage = built?.build?.sourceCoverage;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <FileText className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800">Latest MD files</span>
          <button
            onClick={generate}
            disabled={state === "working" || staged.length === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : built ? <RefreshCw className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            {state === "working" ? "Generating…" : built ? "Regenerate" : "Generate MD files"}
          </button>
        </div>

        <div className="p-4">
          <p className="text-sm text-slate-600 mb-3">
            The whole loaded corpus as two files: the Master file carries every page's source verbatim, the AI file
            the retrieval representation. Same generator the Benchmark tab uses — these are the same bytes, without
            the experiment around them. For one file per bucket, use the bucket tabs on the left.
          </p>

          <Row label="Pages loaded" mono={false}>
            {staged.length ? `${staged.length} across every bucket, Unsorted included` : "— nothing loaded this session"}
          </Row>
          {built && <Row label="Knowledge source">{built.snapshot}</Row>}
          {built?.build && <Row label="Build ID">{built.build.snapshotId}</Row>}
          {built?.build && <Row label="Order policy" mono={false}>{built.build.orderPolicy ?? "dom"}</Row>}
          {coverage && (
            <Row label="Source coverage" mono={false}>
              {coverage.represented.toLocaleString()} of {coverage.sourceUnits.toLocaleString()} units represented
              {" · "}{coverage.missing} missing{" · "}{coverage.unmatched} untraceable
            </Row>
          )}

          {staged.length === 0 && (
            <p className="mt-3 text-xs text-amber-700">
              Drop the .aspx files or a .zip on any bucket first. Every bucket's files are pooled here, so how they
              sort does not change what these two files contain.
            </p>
          )}
          {stale && (
            <p className="mt-3 text-xs text-amber-700">
              <span className="font-semibold">The loaded files changed since this was generated.</span> The numbers
              below describe the previous set — regenerate before downloading.
            </p>
          )}
          {state === "error" && (
            <p className="mt-3 flex items-start gap-2 text-xs text-rose-700">
              <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>

      {built && (
        <>
          <FileCard
            title="Master file"
            subtitle="Every page's source, verbatim — the lossless carrier"
            artifact={built.armB}
            accent="bg-slate-900 hover:bg-slate-700"
            onDownload={() => saveText(built.armB.filename, built.armB.md)}
          />
          <FileCard
            title="AI file"
            subtitle="Retrieval representation — produced only when coverage passes"
            artifact={built.armC}
            accent="bg-emerald-600 hover:bg-emerald-500"
            onDownload={() => saveText(built.armC.filename, built.armC.md)}
            blockedReason="Withheld: validation found missing or untraceable source information. The Benchmark tab reports which pages."
          />

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadBoth}
                disabled={stale || zipping}
                title={stale ? "The loaded files changed — regenerate first" : `Download ${built.snapshot}_Master_File.zip`}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                {zipping ? "Packaging…" : "Download both as .zip"}
              </button>
              <span className="text-xs text-slate-500">
                {pass
                  ? "Both files, named after this build."
                  : "Master file only — the AI file is withheld until coverage passes."}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
