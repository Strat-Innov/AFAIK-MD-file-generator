import React, { useState, useMemo } from "react";
import {
  ListChecks, Loader2, AlertTriangle, Check, X, Download, RefreshCw, Filter, ShieldAlert,
} from "lucide-react";
import { parsePage } from "../lib/aspxDocument";
import {
  buildQuestionSet, scopeOf, titleOf, coreText, EXCLUDED_PAGES,
} from "../lib/questionSet";
import { checkCorpus, blocksBenchmark } from "../lib/sourceIntegrity";
import { checkQuestionSet } from "../lib/questionQuality";
import { buildRunManifest } from "../lib/generationRun";
import { detectSnapshot, UNREGISTERED, evaluationStatusOf } from "../lib/snapshots";
import { GENERATOR_VERSION } from "../lib/version";
import { stagedKey } from "../lib/stagedKey";

/* ------------------------------------------------------------------ *
 * TEST QUESTION GENERATOR — the snapshot's third artifact.
 *
 * The Master file and the AI file are what the knowledge base becomes;
 * this is what measures them. All three come from the same frozen pages,
 * so this panel runs the SAME generator the CLI runs
 * (src/lib/questionSet.js) rather than a second implementation — a
 * second implementation would be a second answer, and the checksum
 * would stop meaning anything.
 *
 * Generation here is a pure read of the staged corpus. It cannot alter
 * the Master file, the AI file, the extraction or the validation.
 * ------------------------------------------------------------------ */

function Row({ label, children, tone }) {
  return (
    <div className="flex items-baseline gap-3 text-xs py-0.5">
      <span className="w-44 shrink-0 text-slate-500">{label}</span>
      <span className={"font-mono break-all " + (tone || "text-slate-700")}>{children}</span>
    </div>
  );
}

const STATUS = {
  "NOT GENERATED": "bg-slate-100 text-slate-600",
  GENERATING: "bg-indigo-50 text-indigo-700",
  GENERATED: "bg-sky-50 text-sky-700",
  VALIDATED: "bg-emerald-50 text-emerald-700",
  WARNING: "bg-amber-100 text-amber-800",
  BLOCKED: "bg-rose-100 text-rose-700",
  FAILED: "bg-rose-100 text-rose-700",
};

function StatusPill({ status }) {
  return (
    <span className={"inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-2 py-0.5 " + (STATUS[status] ?? STATUS["NOT GENERATED"])}>
      {status}
    </span>
  );
}

const saveText = (filename, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/* RFC 4180, the same shape scripts/export-question-csv.mjs writes, so a
 * CSV downloaded here imports into Copilot Studio identically. */
const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const CHUNK = 100;
function csvBatches(questions) {
  const out = [];
  for (let i = 0; i < questions.length; i += CHUNK) {
    const chunk = questions.slice(i, i + CHUNK);
    const from = i + 1;
    const to = i + chunk.length;
    out.push({
      name: `benchmark_${String(out.length + 1).padStart(3, "0")}_Q${String(from).padStart(3, "0")}-Q${String(to).padStart(3, "0")}.csv`,
      body: ["Question,Expected response", ...chunk.map((q) => `${cell(q.question)},${cell(q.answer)}`)].join("\r\n") + "\r\n",
      rows: chunk.length,
    });
  }
  return out;
}

export default function TestQuestionGenerator({ files }) {
  const [state, setState] = useState("NOT GENERATED");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [filter, setFilter] = useState({ category: "", page: "", difficulty: "", warnings: false, q: "" });

  const staged = files || [];
  const signature = stagedKey(staged);
  const stale = Boolean(result) && result.signature !== signature;

  const generate = async () => {
    setState("GENERATING");
    setError("");
    setResult(null);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const detection = await detectSnapshot(staged);
      const snapshot = detection.snapshot;

      // Scope, resolved from the staged corpus — never from a page count
      // or a filename list carried over from an earlier benchmark.
      const names = scopeOf(staged.map((f) => f.name));
      const byName = new Map(staged.map((f) => [f.name, f]));
      const scopedPages = names.map((name) => ({
        name,
        page: parsePage(byName.get(name).raw, { name, path: byName.get(name).path ?? name }),
      }));

      // Source integrity runs FIRST. A page whose body does not belong to
      // its title produces ground truth that is wrong at source, and no
      // later check can see it.
      const integrity = checkCorpus(scopedPages);
      const blocked = integrity.filter(blocksBenchmark);
      const blockedPages = new Set(blocked.map((b) => b.page));
      const warnPages = new Set(
        integrity.filter((r) => r.severity === "medium").map((r) => r.page)
      );

      if (blocked.length) {
        setResult({
          signature, detection, integrity, blocked, questions: [], quality: null,
          sha256: null, manifest: null, warnPages,
        });
        setState("BLOCKED");
        return;
      }

      const entityByPage = new Map(scopedPages.map(({ name, page }) => [name, titleOf(page)]));
      const built = await buildQuestionSet(scopedPages, {
        entityOf: (p) => entityByPage.get(p) ?? null,
      });

      const quality = checkQuestionSet(built.questions, { corpusPages: names });
      const issuesById = new Map();
      for (const f of quality.findings) {
        if (!f.id) continue;
        (issuesById.get(f.id) ?? issuesById.set(f.id, []).get(f.id)).push(f);
      }

      // A question inherits REVIEW from a medium source-integrity finding
      // on its page, and WARNING from its own quality findings. Nothing is
      // dropped — a questionable question is shown, never hidden inside a
      // "validated" count.
      const questions = built.questions.map((q) => {
        const own = issuesById.get(q.id) ?? [];
        const pageWarn = warnPages.has(q.page);
        const status =
          own.some((f) => f.severity === "high") ? "BLOCKED"
          : own.length || pageWarn ? "WARNING"
          : "VALID";
        return { ...q, status, issues: own, sourceReview: pageWarn };
      });

      const manifest = await buildRunManifest({
        snapshot: snapshot?.name ?? UNREGISTERED,
        snapshotSha256: detection.identity.contentSha256,
        generatorVersion: GENERATOR_VERSION,
        masterSha: snapshot?.armBSha256 ?? null,
        aiSha: snapshot?.armCSha256 ?? null,
        questionSetSha: built.sha256,
        questions: questions.length,
        corpusPages: names.length,
        sourceIntegrity: {
          checked: names.length,
          findings: integrity.map((r) => ({ page: r.page, severity: r.severity })),
          blocked: [],
        },
        questionQuality: quality.counts,
      });

      setResult({
        signature, detection, integrity, blocked: [], warnPages,
        questions, quality, sha256: built.sha256, removed: built.removed, manifest,
      });
      setState(
        quality.counts.high ? "FAILED"
        : questions.some((q) => q.status !== "VALID") ? "WARNING"
        : "VALIDATED"
      );
    } catch (e) {
      setError(e.message || String(e));
      setState("FAILED");
    }
  };

  const snapshot = result?.detection?.snapshot ?? null;
  const questions = result?.questions ?? [];
  const warned = questions.filter((q) => q.status !== "VALID");

  const categories = useMemo(() => {
    const c = new Map();
    for (const q of questions) c.set(q.category, (c.get(q.category) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [questions]);

  const filtered = useMemo(() => {
    const needle = filter.q.trim().toLowerCase();
    return questions.filter(
      (q) =>
        (!filter.category || q.category === filter.category) &&
        (!filter.page || q.page === filter.page) &&
        (!filter.difficulty || q.difficulty === filter.difficulty) &&
        (!filter.warnings || q.status !== "VALID") &&
        (!needle || q.question.toLowerCase().includes(needle) || (q.entity ?? "").toLowerCase().includes(needle))
    );
  }, [questions, filter]);

  const pages = useMemo(() => [...new Set(questions.map((q) => q.page))].sort(), [questions]);

  const downloadCsvs = () => {
    for (const b of csvBatches(questions)) saveText(b.name, b.body, "text/csv");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <ListChecks className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold text-slate-800">Test Question Generator</span>
          <span className="ml-auto"><StatusPill status={state} /></span>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">
            The snapshot's third artifact. Generated from the same frozen pages as the Master and AI files by the same
            generator the command line uses, so the question set carries the same identity as the knowledge it measures.
          </p>

          <div className="rounded-lg border border-slate-200 p-3">
            <Row label="Snapshot" tone={snapshot ? "text-slate-700" : "text-amber-700 font-semibold"}>
              {result ? (snapshot?.name ?? UNREGISTERED) : "— generate to identify"}
            </Row>
            {snapshot?.label && <Row label="Also known as">{snapshot.label}</Row>}
            {snapshot && (
              <Row label="Snapshot status">
                {snapshot.status === "frozen" ? "current" : snapshot.status}
                {" · "}
                {evaluationStatusOf(snapshot) === "complete" ? "evaluated" : "not yet evaluated"}
              </Row>
            )}
            <Row label="Corpus pages">
              {result ? `${result.detection.identity.sourceFiles} loaded · ${questions.length ? new Set(questions.map((q) => q.page)).size : 0} contributing` : "—"}
            </Row>
            <Row label="Master MD">{snapshot?.armBSha256 ?? "—"}</Row>
            <Row label="AI MD">{snapshot?.armCSha256 ?? "—"}</Row>
            <Row label="Question set">{result?.sha256 ? "generated" : "not generated"}</Row>
            <Row label="Question set SHA">{result?.sha256 ?? "not generated"}</Row>
            <Row label="Question count">{result ? questions.length : "—"}</Row>
            {result?.manifest && <Row label="Generation run">{result.manifest.generationRunId}</Row>}
            {result?.removed && (
              <Row label="Dropped as ambiguous">
                {result.removed.dropped} ({result.removed.ambiguous} genuinely ambiguous)
              </Row>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={generate}
              disabled={state === "GENERATING" || staged.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 text-white text-sm px-3.5 py-2 hover:bg-violet-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              {state === "GENERATING" ? <Loader2 className="h-4 w-4 animate-spin" /> : result ? <RefreshCw className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
              {state === "GENERATING" ? "Generating…" : result ? "Regenerate" : "Generate Test Questions"}
            </button>
            {questions.length > 0 && !stale && (
              <>
                <button
                  onClick={() => saveText("question-set.json", JSON.stringify({ meta: result.manifest, questions }, null, 1), "application/json")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-3 py-2 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> question-set.json
                </button>
                <button
                  onClick={downloadCsvs}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-3 py-2 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV batches ({csvBatches(questions).length})
                </button>
                <button
                  onClick={() => saveText("generation-run.json", JSON.stringify(result.manifest, null, 1), "application/json")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-3 py-2 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> run manifest
                </button>
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs px-3 py-2 hover:bg-slate-50"
                >
                  <Filter className="h-3.5 w-3.5" /> {showPreview ? "Hide" : "Preview"} questions
                </button>
              </>
            )}
          </div>

          {staged.length === 0 && (
            <p className="text-xs text-amber-700">Nothing loaded this session. Drop the corpus first.</p>
          )}
          {stale && (
            <p className="text-xs text-amber-700">
              <span className="font-semibold">The staged files changed since this set was generated.</span>{" "}
              Regenerate before exporting — nothing should leave with an identity you have not seen.
            </p>
          )}
          {state === "FAILED" && error && <p className="text-xs text-rose-700">Generation failed: {error}</p>}
        </div>
      </div>

      {/* ---- source integrity blocked the run ---- */}
      {result?.blocked?.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <ShieldAlert className="h-4 w-4" /> Question generation blocked
          </div>
          <p className="mt-1 text-xs text-rose-700">
            {result.blocked.length} page(s) flagged at high confidence. A page whose body does not belong to its title
            produces ground truth that is wrong at source, so no questions were generated. Fix the source first.
          </p>
          <ul className="mt-2 space-y-1">
            {result.blocked.map((b) => (
              <li key={b.page} className="font-mono text-[11px] text-rose-800">
                {b.page} — {b.findings.map((f) => f.rule).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- categories ---- */}
      {questions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 p-4">
            <span className="text-sm font-semibold text-slate-800">{questions.length} questions generated</span>
            <span className="ml-auto text-xs text-slate-500">
              {questions.length - warned.length} valid · {warned.length} need review
            </span>
          </div>
          <div className="grid gap-x-6 gap-y-1 p-4 sm:grid-cols-2">
            {categories.map(([c, n]) => (
              <div key={c} className="flex items-baseline gap-3 text-xs">
                <span className="text-slate-600">{c}</span>
                <span className="ml-auto font-mono text-slate-800">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- warnings, never hidden ---- */}
      {warned.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> {warned.length} question(s) require review
          </div>
          <p className="mt-1 text-xs text-amber-800">
            These are included in the set and marked, not removed. Silently dropping them would hide a benchmark-quality
            problem; silently keeping them inside a "validated" count would misreport one.
          </p>
          <ul className="mt-3 space-y-2">
            {warned.slice(0, 12).map((q) => (
              <li key={q.id} className="rounded border border-amber-200 bg-white p-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] font-semibold text-slate-700">{q.id}</span>
                  <StatusPill status={q.status} />
                  <span className="ml-auto font-mono text-[10px] text-slate-500">{q.page}</span>
                </div>
                <div className="mt-1 text-xs text-slate-700">{q.question}</div>
                {q.issues.map((f, i) => (
                  <div key={i} className="mt-1 text-[11px] text-amber-800">
                    <span className="font-semibold">{f.rule}</span>: {f.detail}
                  </div>
                ))}
                {q.sourceReview && (
                  <div className="mt-1 text-[11px] text-amber-800">
                    <span className="font-semibold">source-review</span>: this page carries a medium source-integrity
                    finding.
                  </div>
                )}
              </li>
            ))}
          </ul>
          {warned.length > 12 && (
            <p className="mt-2 text-[11px] text-amber-800">…and {warned.length - 12} more. Use the preview filter.</p>
          )}
        </div>
      )}

      {/* ---- preview ---- */}
      {showPreview && questions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
            <span className="text-sm font-semibold text-slate-800">Preview</span>
            <span className="text-xs text-slate-500">{filtered.length} shown</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
                placeholder="search question or entity"
                className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-violet-400"
              />
              <select
                value={filter.category}
                onChange={(e) => setFilter({ ...filter, category: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="">all categories</option>
                {categories.map(([c]) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={filter.page}
                onChange={(e) => setFilter({ ...filter, page: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="">all pages</option>
                {pages.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                value={filter.difficulty}
                onChange={(e) => setFilter({ ...filter, difficulty: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="">all difficulties</option>
                {["easy", "medium", "hard"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={filter.warnings}
                  onChange={(e) => setFilter({ ...filter, warnings: e.target.checked })}
                />
                warnings only
              </label>
            </div>
          </div>
          <div className="max-h-[32rem] overflow-auto p-4">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-white text-slate-500">
                <tr>
                  <th className="py-1 pr-2 text-left font-medium">id</th>
                  <th className="py-1 pr-2 text-left font-medium">question</th>
                  <th className="py-1 pr-2 text-left font-medium">expected</th>
                  <th className="py-1 pr-2 text-left font-medium">evidence</th>
                  <th className="py-1 text-left font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((q) => (
                  <tr key={q.id} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2 font-mono text-slate-500">{q.id}</td>
                    <td className="py-1 pr-2 text-slate-800">
                      {q.question}
                      <div className="text-[10px] text-slate-400">
                        {q.category} · {q.difficulty} · {q.page}
                        {q.sourceSection != null ? ` · section ${q.sourceSection}` : ""}
                      </div>
                    </td>
                    <td className="py-1 pr-2 font-mono text-slate-700">{q.answer}</td>
                    <td className="py-1 pr-2 font-mono text-slate-500">{q.evidence}</td>
                    <td className="py-1">
                      {q.status === "VALID"
                        ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                        : q.status === "BLOCKED"
                          ? <X className="h-3.5 w-3.5 text-rose-600" />
                          : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="mt-2 text-[11px] text-slate-500">Showing the first 300 of {filtered.length}. Narrow the filter to see the rest.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
