import React, { useState, useEffect } from "react";
import {
  Download, FlaskConical, Loader2, ShieldCheck, ShieldAlert, Check, X,
  AlertTriangle, RefreshCw, FileArchive, Fingerprint, Package, Layers,
} from "lucide-react";
import {
  buildBenchmarkArtifacts, buildBucketPackage, packageEntries, compareToCanonical,
  verifyArtifacts, fileSetSignature, CANONICAL, SNAPSHOT, SNAPSHOT_CLOCK,
  BENCHMARK_ZIP_FILE, CONSOLIDATED_ZIP_FILE, COPILOT_FILE_LIMIT,
} from "../lib/benchmarkExport";
import { createZip } from "../lib/zip";
import { GENERATOR_VERSION } from "../lib/version";
import { formatBucketReport } from "../lib/generate";

/* ------------------------------------------------------------------ *
 * Benchmark workspace — admin surface, deliberately outside the normal
 * workflow.
 *
 * The product is still the per-bucket Master files; this page exists so
 * the two consolidated artifacts the Copilot Studio experiment needs can
 * be obtained without a checkout, a terminal, or hunting through a
 * gitignored directory. Load the corpus, press Generate, press Download
 * Both.
 *
 * Everything on screen is derived from src/lib/benchmarkExport.js, the
 * same recipe `npm run benchmark:arms` calls, so nothing here can change
 * what the artifacts contain — only how easily they can be obtained.
 * ------------------------------------------------------------------ */

function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const saveText = (filename, text, type = "text/markdown") => saveBlob(filename, new Blob([text], { type }));

const sizeLabel = (bytes) =>
  bytes >= 1e6 ? (bytes / 1e6).toFixed(2) + " MB" : (bytes / 1e3).toFixed(1) + " KB";

function Row({ label, children, tone }) {
  return (
    <div className="flex items-baseline gap-3 text-xs py-0.5">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      <span className={"font-mono break-all " + (tone || "text-slate-700")}>{children}</span>
    </div>
  );
}

function Pill({ ok, yes, no }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-0.5 " +
        (ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800")
      }
    >
      {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {ok ? yes : no}
    </span>
  );
}

function Card({ title, right, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ArmCard({ title, subtitle, artifact, matchesCanonical, verified, accent, onDownload, blockedReason, stale }) {
  const produced = Boolean(artifact.sha256);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <button
          onClick={onDownload}
          disabled={!produced || stale}
          title={!produced ? blockedReason : stale ? "The staged files changed — regenerate first" : `Download ${artifact.filename}`}
          className={
            "inline-flex shrink-0 items-center gap-2 rounded-lg text-white text-sm px-3.5 py-2 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed " +
            accent
          }
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>
      <div className="p-4">
        <Row label="Filename">{artifact.filename}</Row>
        <Row label="Size">{produced ? `${sizeLabel(artifact.bytes)} · ${artifact.bytes.toLocaleString()} bytes` : "—"}</Row>
        <Row label="Pages">{artifact.pages}</Row>
        <Row label="SHA-256">{artifact.sha256 || "not produced"}</Row>
        {artifact.validation && (
          <>
            <Row label="Coverage">
              {artifact.validation.status === "PASS"
                ? `PASS — ${artifact.validation.representedUnits.toLocaleString()} / ${artifact.validation.sourceUnits.toLocaleString()} represented`
                : "FAIL"}
            </Row>
            <Row label="Source units">{artifact.validation.sourceUnits.toLocaleString()}</Row>
            <Row label="Represented units">{artifact.validation.representedUnits.toLocaleString()}</Row>
            <Row
              label="Untraceable units"
              tone={artifact.validation.untraceableUnits ? "text-amber-700 font-semibold" : undefined}
            >
              {artifact.validation.untraceableUnits}
            </Row>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-3">
          {produced ? (
            <>
              <Pill ok={matchesCanonical} yes="canonical artifact" no="differs from canonical" />
              {verified && (
                <Pill
                  ok={verified.selfConsistent}
                  yes="re-hash verified"
                  no="re-hash MISMATCH"
                />
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 text-[10px] font-semibold px-2 py-0.5">
              <X className="h-3 w-3" /> blocked by validation
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The recommended package: both arms cut on the same five production
 * bucket boundaries, so no file approaches the 16 MB the tenant's
 * "Add knowledge" upload enforces, and packaging stays constant across
 * arms — 5 files each, same buckets, same pages. Only the
 * representation differs, which is what the experiment is measuring.
 * ------------------------------------------------------------------ */
function PackageSection({ bucketMap, unsortedFiles }) {
  const [state, setState] = useState("idle");
  const [pkg, setPkg] = useState(null);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState("");

  const buckets = Object.entries(bucketMap || {});
  const staged = buckets.reduce((n, [, f]) => n + f.length, 0);
  const orphans = unsortedFiles || [];
  const signature = fileSetSignature(buckets.flatMap(([name, f]) => f.map((x) => `${name}\u0001${x.name}`)));
  const stale = Boolean(pkg) && pkg.signature !== signature;

  const generate = async () => {
    setState("working");
    setError("");
    setPkg(null);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const built = await buildBucketPackage(bucketMap);
      setPkg({ ...built, signature });
      setState("done");
    } catch (e) {
      setError(e.message || String(e));
      setState("error");
    }
  };

  const downloadPackage = async () => {
    setZipping(true);
    try {
      const zip = await createZip(packageEntries(pkg), { modifiedAt: SNAPSHOT_CLOCK });
      saveBlob(BENCHMARK_ZIP_FILE, new Blob([zip], { type: "application/zip" }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setZipping(false);
    }
  };

  const pass = pkg?.status === "PASS";
  const oversize = pkg?.oversize?.length ?? 0;
  // Every reason the package must not be handed over, checked here
  // rather than discovered on the upload screen.
  const blocked = !pkg || stale || !pass || oversize > 0 || orphans.length > 0;

  return (
    <div className="space-y-4">
      <Card
        title="Copilot-safe benchmark package"
        right={
          <button
            onClick={generate}
            disabled={state === "working" || staged === 0 || orphans.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : pkg ? <RefreshCw className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
            {state === "working" ? "Generating…" : pkg ? "Regenerate" : "Generate Package"}
          </button>
        }
      >
        <p className="text-sm font-medium text-slate-700 mb-1">
          {buckets.length} files per arm — identical packaging
        </p>
        <p className="text-xs text-slate-500 mb-3">
          Both arms are split on the <em>production</em> bucket boundaries — each Arm B file is the Master file that
          bucket already produces, each Arm C file its AI-optimized counterpart. Same buckets, same pages, same file
          count. Representation is the only thing that differs, and every file stays under the{" "}
          {(COPILOT_FILE_LIMIT / 1024 / 1024).toFixed(0)} MB the upload accepts.
        </p>

        <Row label="Snapshot">{SNAPSHOT}</Row>
        <Row label="Buckets">{buckets.length ? buckets.map(([n]) => n).sort().join(", ") : "—"}</Row>
        <Row label="Pages staged">{staged}</Row>
        <Row label="File-set SHA-256">{pkg ? pkg.filesSha256 : "— generate to compute"}</Row>

        {orphans.length > 0 && (
          <p className="mt-3 text-xs text-rose-700">
            <span className="font-semibold">{orphans.length} file(s) are still Unsorted.</span> They belong to no
            bucket, so the package would silently leave them out. Assign them first — the package is only meaningful
            if it covers every page.
          </p>
        )}
        {staged === 0 && orphans.length === 0 && (
          <p className="mt-3 text-xs text-amber-700">
            No files sorted into buckets this session. Drop the corpus above so it routes into the five buckets.
          </p>
        )}
        {state === "working" && (
          <p className="mt-3 text-xs text-slate-500">Generating and validating {staged} pages across {buckets.length} buckets…</p>
        )}
        {state === "error" && <p className="mt-3 text-xs text-rose-700">Generation failed: {error}</p>}
        {stale && (
          <p className="mt-3 text-xs text-amber-700">
            The staged files changed since this build — regenerate before downloading.
          </p>
        )}
      </Card>

      {pkg && (
        <>
          <Card
            title="Package contents"
            right={pass ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="font-medium py-1.5 pr-3">File</th>
                    <th className="font-medium py-1.5 pr-3 text-right">Pages</th>
                    <th className="font-medium py-1.5 pr-3 text-right">Size</th>
                    <th className="font-medium py-1.5 pr-3 text-right">of limit</th>
                    <th className="font-medium py-1.5">SHA-256</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[...pkg.armB, ...pkg.armC].map((a) => {
                    const pct = (a.bytes / COPILOT_FILE_LIMIT) * 100;
                    const over = a.bytes > COPILOT_FILE_LIMIT;
                    return (
                      <tr key={a.file} className="border-b border-slate-50 last:border-0">
                        <td className="py-1 pr-3 text-slate-700">{a.file}</td>
                        <td className="py-1 pr-3 text-right text-slate-600">{a.pages}</td>
                        <td className="py-1 pr-3 text-right text-slate-600">{a.bytes.toLocaleString()}</td>
                        <td className={"py-1 pr-3 text-right " + (over ? "text-rose-700 font-semibold" : pct > 75 ? "text-amber-700" : "text-slate-500")}>
                          {pct.toFixed(1)}%
                        </td>
                        <td className="py-1 text-slate-500 break-all">{a.sha256 ? a.sha256.slice(0, 24) + "…" : "blocked"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-1">
              <Row label="Pages covered">{pkg.pages}</Row>
              <Row label="Arm C coverage" tone={pass ? "text-slate-700" : "text-rose-700 font-semibold"}>
                {pkg.status} — {pkg.totals.representedUnits.toLocaleString()} / {pkg.totals.sourceUnits.toLocaleString()} represented, {pkg.totals.untraceableUnits} untraceable
              </Row>
              <Row label="Largest file" tone={oversize ? "text-rose-700 font-semibold" : "text-slate-700"}>
                {Math.max(...pkg.armB.map((a) => a.bytes)).toLocaleString()} bytes ·{" "}
                {((Math.max(...pkg.armB.map((a) => a.bytes)) / COPILOT_FILE_LIMIT) * 100).toFixed(1)}% of the limit
              </Row>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <button
                onClick={downloadPackage}
                disabled={blocked || zipping}
                title={
                  orphans.length ? "Unsorted files must be assigned first"
                    : stale ? "The staged files changed — regenerate first"
                    : !pass ? "A bucket failed validation — Arm C is withheld"
                    : oversize ? "A file exceeds the upload limit"
                    : `Download ${BENCHMARK_ZIP_FILE}`
                }
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {zipping ? "Packaging…" : "Download Package"}
              </button>
              <span className="text-xs text-slate-500 font-mono">{BENCHMARK_ZIP_FILE}</span>
            </div>
            {oversize > 0 && (
              <p className="mt-3 text-xs text-rose-700">
                {oversize} file(s) exceed the {(COPILOT_FILE_LIMIT / 1024 / 1024).toFixed(0)} MB upload limit:{" "}
                {pkg.oversize.map((a) => a.file).join(", ")}. The package is withheld — uploading it would fail on the
                same screen the consolidated Arm B failed on.
              </p>
            )}
            {!pass && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs text-rose-700">
                  {pkg.failed.length} bucket(s) failed validation, so the Arm C half of the package is withheld:{" "}
                  {pkg.failed.map((f) => f.bucket).join(", ")}.
                </p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-rose-100 bg-white p-2 text-[11px] text-rose-800">
                  {pkg.failed.map((f) => formatBucketReport(f.bucket, f.result)).join("\n\n")}
                </pre>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function BenchmarkExport({ files, bucketMap, unsortedFiles }) {
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [built, setBuilt] = useState(null);
  const [verified, setVerified] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState("");

  const staged = files || [];
  const signature = fileSetSignature(staged);
  // A build describes the files it was made from. If those change, the
  // numbers on screen stop describing anything downloadable, so the
  // result is marked stale and the buttons wait for a regenerate rather
  // than handing over an artifact whose identity was never shown.
  const stale = Boolean(built) && built.signature !== signature;

  useEffect(() => { setVerified(null); }, [built]);

  const generate = async () => {
    setState("working");
    setError("");
    setBuilt(null);
    setVerified(null);
    // Let the spinner paint before the synchronous build.
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await buildBenchmarkArtifacts(staged);
      setBuilt({ ...result, signature: fileSetSignature(staged) });
      setState("done");
    } catch (e) {
      setError(e.message || String(e));
      setState("error");
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      setVerified(await verifyArtifacts(built));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setVerifying(false);
    }
  };

  const downloadBoth = async () => {
    setZipping(true);
    try {
      const zip = await createZip(
        [
          { name: built.armB.filename, text: built.armB.md },
          { name: built.armC.filename, text: built.armC.md },
        ],
        { modifiedAt: SNAPSHOT_CLOCK }
      );
      saveBlob(CONSOLIDATED_ZIP_FILE, new Blob([zip], { type: "application/zip" }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setZipping(false);
    }
  };

  const match = built ? compareToCanonical(built) : null;
  const pass = built?.armC.validation.status === "PASS";
  const canonicalCorpus = signature && staged.length === CANONICAL.pages && built && match.files;

  return (
    <div className="space-y-4">
      {/* ---- what this page is, and what it is not ---- */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <FlaskConical className="h-4 w-4 text-indigo-600" />
          <span className="text-sm font-semibold text-slate-800">Benchmark workspace</span>
          <span className="ml-auto text-xs text-slate-400">admin</span>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Generate the two controlled knowledge representations used for Copilot Studio benchmarking.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-900">
              <span className="font-semibold">Benchmark artifacts are consolidated into one file per arm.</span>{" "}
              Do not use the production bucket exports for this experiment.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1">
                <Package className="h-3.5 w-3.5 text-emerald-600" /> Production bucket exports
              </div>
              <p className="text-xs text-slate-500">
                One Master file and one AI file <em>per tag</em>, stamped with the time you generated them. What the
                buckets in the sidebar hand you. Unchanged by this page.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1">
                <FlaskConical className="h-3.5 w-3.5 text-indigo-600" /> Benchmark artifacts
              </div>
              <p className="text-xs text-slate-500">
                One consolidated file per arm over all pages, on a fixed clock so it can be checksummed. Only these
                belong in the experiment.
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Benchmark packaging is identical across arms so the Copilot Studio experiment changes representation, not
            file packaging.
          </p>
        </div>
      </div>

      <PackageSection bucketMap={bucketMap} unsortedFiles={unsortedFiles} />

      {/* ---- the single-file pair: what the frozen checksums describe ---- */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <Package className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800">Consolidated arms — one file each</span>
          <span className="ml-auto text-xs text-slate-400">alternative</span>
        </div>
        <div className="p-4 text-xs text-slate-500">
          The original packaging: all {CANONICAL.pages} pages in a single file per arm. Its checksums are the frozen
          ones this work was verified against, and it is still the right shape wherever a single large file can be
          uploaded. It is <span className="font-semibold text-slate-700">not</span> usable on the Add-knowledge screen
          in this tenant — Arm B is {(37176764 / 1024 / 1024).toFixed(1)} MB against a{" "}
          {(COPILOT_FILE_LIMIT / 1024 / 1024).toFixed(0)} MB cap. Use the package above for the experiment.
        </div>
      </div>

      {/* ---- snapshot + corpus ---- */}
      <Card
        title="Snapshot"
        right={
          <button
            onClick={generate}
            disabled={state === "working" || staged.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {state === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : built ? <RefreshCw className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
            {state === "working" ? "Generating…" : built ? "Regenerate" : "Generate Benchmark Artifacts"}
          </button>
        }
      >
        <Row label="Snapshot">{SNAPSHOT}</Row>
        <Row label="Generator">{built?.generatorVersion || GENERATOR_VERSION}</Row>
        <Row label="Snapshot clock">{SNAPSHOT_CLOCK.toISOString()}</Row>
        <Row
          label="Source files"
          tone={staged.length === CANONICAL.pages ? "text-slate-700" : "text-amber-700 font-semibold"}
        >
          {staged.length} loaded · {CANONICAL.pages} expected
        </Row>
        <Row label="File-set SHA-256">{built ? built.filesSha256 : "— generate to compute"}</Row>
        {built && <div className="pt-3"><Pill ok={match.files} yes="canonical August snapshot" no="not the canonical August snapshot" /></div>}

        {staged.length === 0 && (
          <p className="mt-3 text-xs text-amber-700">
            Nothing loaded this session. Drop the corpus above first — all {CANONICAL.pages} pages, or the .zip. Every
            bucket's files are pooled into one snapshot here, so how they sort does not matter.
          </p>
        )}
        {staged.length > 0 && staged.length !== CANONICAL.pages && (
          <p className="mt-3 text-xs text-amber-700">
            {staged.length} files loaded, not {CANONICAL.pages}. This will still build a valid, deterministic pair of
            artifacts — but from a different page set than the pre-flight was verified against.
          </p>
        )}
        {built && !match.files && staged.length === CANONICAL.pages && (
          <p className="mt-3 text-xs text-amber-700">
            The page count is right but the file set is not the canonical one — a filename differs. Most often this is
            the en dash in <span className="font-mono">PROJECT-DEVELOPMENT-–-PRIMING-&amp;-INNOVATION.aspx</span>, which
            command-line <span className="font-mono">unzip</span> escapes to <span className="font-mono">#U2013</span>{" "}
            and the browser does not. Page content is unaffected; the checksums below will differ from the canonical
            ones. Record the ones you actually upload.
          </p>
        )}
        {state === "working" && (
          <p className="mt-3 text-xs text-slate-500">
            Parsing and validating {staged.length} pages — this runs the full gate, the same one a bucket download runs.
          </p>
        )}
        {state === "error" && <p className="mt-3 text-xs text-rose-700">Generation failed: {error}</p>}
      </Card>

      {built && stale && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">The staged files changed since this build.</span> Downloads are held until
            you regenerate, so nothing leaves with an identity you have not seen.
          </span>
        </div>
      )}

      {built && (
        <>
          <ArmCard
            title="Arm B — Master"
            subtitle="Consolidated master file · the representation the app shipped before this work"
            artifact={built.armB}
            matchesCanonical={match.armB}
            verified={verified?.armB}
            accent="bg-slate-900 hover:bg-slate-700"
            onDownload={() => saveText(built.armB.filename, built.armB.md)}
            stale={stale}
          />

          <ArmCard
            title="Arm C — AI Optimized"
            subtitle="Retrieval representation · produced only on a validation PASS"
            artifact={built.armC}
            matchesCanonical={match.armC}
            verified={verified?.armC}
            accent="bg-emerald-600 hover:bg-emerald-500"
            onDownload={() => saveText(built.armC.filename, built.armC.md)}
            blockedReason="Blocked: validation found missing or untraceable source information"
            stale={stale}
          />

          {/* ---- one click for the pre-flight ---- */}
          <Card title="Both arms">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadBoth}
                disabled={!pass || stale || zipping}
                title={
                  !pass ? "Arm C is blocked by validation — download Arm B on its own"
                    : stale ? "The staged files changed — regenerate first"
                    : `Download ${CONSOLIDATED_ZIP_FILE}`
                }
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-3.5 py-2 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {zipping ? "Packaging…" : "Download Both"}
              </button>
              <button
                onClick={verify}
                disabled={verifying || stale}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 text-slate-700 text-sm px-3.5 py-2 hover:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                {verifying ? "Verifying…" : "Verify Artifacts"}
              </button>
              <button
                onClick={() => saveText("manifest.json", JSON.stringify(built.manifest, null, 2), "application/json")}
                disabled={stale}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 text-slate-700 text-sm px-3.5 py-2 hover:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <Download className="h-4 w-4" /> manifest.json
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              <span className="font-mono">{CONSOLIDATED_ZIP_FILE}</span> contains{" "}
              <span className="font-mono">{built.armB.filename}</span> and{" "}
              <span className="font-mono">{built.armC.filename}</span> — the two files to upload, one per arm.
            </p>
            {verified && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">Verification</div>
                <Row label="Arm B re-hash" tone={verified.armB.selfConsistent ? "text-emerald-700" : "text-rose-700 font-semibold"}>
                  {verified.armB.sha256}
                </Row>
                <Row label="Arm C re-hash" tone={verified.armC.selfConsistent === false ? "text-rose-700 font-semibold" : "text-emerald-700"}>
                  {verified.armC.sha256 || "not produced"}
                </Row>
                <p className="mt-2 text-xs text-slate-600">
                  {verified.ok
                    ? "Re-hashed from the bytes in hand; both match the digests reported above, so the checksums on screen describe what the buttons hand over."
                    : "A re-hash disagrees with the reported digest. Do not upload these files — regenerate and check again."}
                </p>
              </div>
            )}
          </Card>

          {/* ---- the standing summary ---- */}
          <Card
            title="Benchmark status"
            right={
              pass ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />
            }
          >
            <ul className="space-y-1.5 text-xs">
              {[
                [canonicalCorpus, "Canonical snapshot", `${built.manifest.corpusPages} pages, file set ${match.files ? "matches" : "differs from"} the verified corpus`],
                [match.armB && match.armC, "Deterministic export", match.armB && match.armC ? "both arms reproduce the frozen checksums" : "artifacts differ from the frozen checksums — valid, but not the canonical run"],
                [pass, "Arm C coverage", pass ? `PASS — ${built.armC.validation.representedUnits.toLocaleString()} / ${built.armC.validation.sourceUnits.toLocaleString()} represented, ${built.armC.validation.untraceableUnits} untraceable` : "FAIL — Arm C withheld"],
              ].map(([ok, label, detail]) => (
                <li key={label} className="flex items-start gap-2">
                  {ok
                    ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
                    : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />}
                  <span className="text-slate-700">
                    <span className="font-medium">{label}</span> <span className="text-slate-500">— {detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {!pass && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs text-rose-700">
                Arm C is blocked: {built.optimized.failed.length} page(s) did not validate. Arm B is unaffected and
                still downloadable — it is the fidelity layer, and it is exactly what you audit with when the optimized
                one has gone wrong.
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
