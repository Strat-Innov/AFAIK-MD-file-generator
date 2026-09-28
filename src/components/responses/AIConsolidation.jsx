import React, { useMemo, useState } from "react";
import { Copy, Download, ShieldAlert, Check, Upload, FileJson, ArrowRight } from "lucide-react";
import { LAYER_DERIVED } from "../../lib/responses/views";
import { buildIntentRequest } from "../../lib/responses/ai/intentPackage";
import { validateIntentReply } from "../../lib/responses/ai/intentResult";
import { DEFAULT_PROVIDER } from "../../lib/responses/ai/provider";
import { saveBlob } from "../BenchmarkExport";
import { LayerBadge, Stat, FlagBadge } from "./common";
import { StatusBadge } from "./ExtractedQA";
import { ValidationSummary } from "./IntentCandidates";

const sizeLabel = (chars) => (chars >= 1e6 ? (chars / 1e6).toFixed(1) + "M" : Math.round(chars / 1e3) + "k") + " characters";

/* AI Intent Consolidation: shows exactly what would be given to Claude,
 * lets the user take it out by their own action, and validates the reply
 * they bring back. Nothing is sent or imported on the app's initiative. */
export default function AIConsolidation({ records, onGoImport, current, onImported, onViewIntents }) {
  // Off by default: the model needs QA IDs, not session IDs or file names.
  const [includeSourceRefs, setIncludeSourceRefs] = useState(false);
  const [copied, setCopied] = useState("");
  const [reply, setReply] = useState("");
  const [attempt, setAttempt] = useState(null); // last validation result, accepted or not
  const provider = DEFAULT_PROVIDER;

  const request = useMemo(() => buildIntentRequest(records, { includeSourceRefs }), [records, includeSourceRefs]);
  const { promptText } = useMemo(() => provider.render(request), [provider, request]);

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No extracted questions yet — import session exports first.
        <div className="mt-3">
          <button onClick={onGoImport} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            <Upload className="h-3.5 w-3.5" /> Import responses
          </button>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied("Prompt copied. Paste it into Claude.");
    } catch {
      setCopied("The browser blocked clipboard access. Use “Download prompt” instead.");
    }
  };
  const downloadPrompt = () => saveBlob("AFAIK_intent-clustering_prompt.txt", new Blob([promptText], { type: "text/plain" }));
  const validateAndImport = (text) => {
    const result = validateIntentReply(text, request);
    setAttempt(result);
    if (result.ok) onImported(result, request);
  };
  const readReplyFile = async (file) => {
    const text = await file.text();
    setReply(text);
    validateAndImport(text);
  };
  const downloadPackage = () =>
    saveBlob("AFAIK_intent-clustering_package.json", new Blob([JSON.stringify(request, null, 2)], { type: "application/json" }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-slate-800">AI Intent Consolidation — group questions by information need</h1>
          <LayerBadge layer={LAYER_DERIVED} note="nothing is sent automatically" />
        </div>
        <p className="text-sm text-slate-600 mt-2">
          The user's question is the signal; the agent's answer is context. Claude is asked which questions share one
          information need and which needs look like potential knowledge gaps — not whether AFAIK answered well, and not
          to write any answers.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Questions in the package" value={request.counts.items} />
          <Stat label="Left out (conversational)" value={request.counts.excluded} />
          <Stat label="Potential knowledge gaps (not found)" value={request.counts.potentialKnowledgeGaps} tone={request.counts.potentialKnowledgeGaps ? "amber" : "slate"} />
          <Stat label="Prompt size" value={sizeLabel(promptText.length)} />
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">This prompt contains real employee questions and AFAIK's answers.</div>
          It leaves this app only if you copy or download it. Paste it only into a Claude workspace your organisation has
          approved for this data. Provider: {provider.label}.
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includeSourceRefs} onChange={(e) => setIncludeSourceRefs(e.target.checked)} />
            Include session ID and source file per question
            <span className="text-xs text-slate-400">(reference only — QA IDs keep the link to the source either way)</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadPackage}
              title="The app's input data, for your records. It is not the reply and is not what you send to Claude — send the prompt."
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" /> Input package (records only)
            </button>
            <button onClick={downloadPrompt} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" /> Download prompt
            </button>
            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
              {copied.startsWith("Prompt copied") ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Generate &amp; copy Claude prompt
            </button>
          </div>
        </div>
        {copied && <div className="px-4 pt-3 text-xs text-slate-600">{copied}</div>}
        <div className="px-4 pt-3 text-xs text-slate-500">Package <span className="font-mono">{request.packageId}</span> — Claude's reply must name it.</div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">QA ID</th>
                <th className="px-2 py-2 font-medium">User question (as sent)</th>
                <th className="px-2 py-2 font-medium">Answer status</th>
                <th className="px-4 py-2 font-medium">Answer type</th>
              </tr>
            </thead>
            <tbody>
              {records.filter((r) => r.includeInConsolidation).map((r) => (
                <tr key={r.id} className="border-b border-slate-50 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.id}</td>
                  <td className="px-2 py-2 text-slate-800">{r.question}</td>
                  <td className="px-2 py-2"><StatusBadge status={r.answerStatus} /></td>
                  <td className="px-4 py-2 text-xs">
                    {r.answerType ? <FlagBadge tone={r.potentialKnowledgeGap ? "amber" : "slate"}>{r.answerType}</FlagBadge> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {request.excluded.length > 0 && (
          <div className="p-4 text-xs text-slate-500">
            Left out as conversational (kept in Extracted Q&amp;A): {request.excluded.map((x) => `${x.qaId} “${x.question.trim()}”`).join(" · ")}
          </div>
        )}
        <details className="border-t border-slate-100">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-slate-600">Show the full prompt text</summary>
          <pre className="whitespace-pre-wrap break-words px-4 pb-4 text-xs font-mono text-slate-700 max-h-[32rem] overflow-y-auto">{promptText}</pre>
        </details>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Import Claude's reply</div>
          {current && (
            <button onClick={onViewIntents} className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 underline">
              {current.intents.length} intent candidates imported for {current.packageId} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Paste the JSON Claude returned. It is checked before anything is kept: the package must match, every field must be
          present, and each of the {request.items.length} QA IDs must appear exactly once. A reply that fails any check is
          rejected whole.
        </p>
        <textarea
          value={reply} onChange={(e) => setReply(e.target.value)} rows={6} spellCheck={false}
          placeholder='{"packageId": "…", "intents": [ … ]}'
          aria-label="Claude's JSON reply"
          className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => validateAndImport(reply)} disabled={!reply.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" /> Validate &amp; import
          </button>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
            <FileJson className="h-3.5 w-3.5" /> Load reply file
            <input type="file" accept=".json,.txt" className="hidden" onChange={(e) => { if (e.target.files[0]) readReplyFile(e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
        {attempt && <ValidationSummary result={attempt} />}
      </div>
    </div>
  );
}
