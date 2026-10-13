import React, { useRef, useState } from "react";
import { BookOpen, FileText, Loader2, ShieldAlert, X } from "lucide-react";
import {
  indexKnowledge, KNOWLEDGE_VERDICT, KNOWLEDGE_CHECK_RULE, COVERED_AT, WEAK_AT,
} from "../../lib/responses/knowledgeCheck";
import { FlagBadge } from "./common";

/* ------------------------------------------------------------------ *
 * Knowledge check — the uploaded knowledge file next to the questions
 * users actually asked.
 *
 * Answer status says whether the agent replied. It cannot say whether
 * the knowledge base held the answer, so one "not answered" can mean
 * two opposite things: the page is missing, or the page is there and
 * was never found. Those need different people to fix them.
 *
 * Every verdict here is shown with the page, the score and the words
 * behind it, because the check is lexical: it finds supporting content,
 * it does not confirm that an answer was right.
 * ------------------------------------------------------------------ */

export const VERDICT_STYLE = {
  [KNOWLEDGE_VERDICT.SUPPORTED]: {
    tone: "emerald", label: "Supported",
    hint: "The file carries this content and the user got a reply.",
  },
  [KNOWLEDGE_VERDICT.RETRIEVAL_GAP]: {
    tone: "amber", label: "Retrieval gap",
    hint: "The file carries this content, but the user got no answer. The content is there — retrieval or the agent is the problem, not the knowledge base.",
  },
  [KNOWLEDGE_VERDICT.ANSWER_NOT_IN_KB]: {
    tone: "rose", label: "Answered off-file",
    hint: "The user got a reply, but nothing in the file matches the question. Either the file is out of date or the answer did not come from it. Worth reading.",
  },
  [KNOWLEDGE_VERDICT.KNOWLEDGE_GAP]: {
    tone: "rose", label: "Content missing",
    hint: "Nothing in the file matches, and the user got no answer. This is content to write.",
  },
  [KNOWLEDGE_VERDICT.WEAK_MATCH]: {
    tone: "amber", label: "Weak match",
    hint: "Only part of the question's wording appears on the best page. Too thin to call either way — read it.",
  },
  [KNOWLEDGE_VERDICT.CANNOT_CHECK]: {
    tone: "slate", label: "Cannot check",
    hint: "Either the transcript does not show what the user got, or the question has no words specific enough to search on.",
  },
};

/* The four that call for action, in the order someone would work them. */
const HEADLINE = [
  KNOWLEDGE_VERDICT.KNOWLEDGE_GAP,
  KNOWLEDGE_VERDICT.RETRIEVAL_GAP,
  KNOWLEDGE_VERDICT.ANSWER_NOT_IN_KB,
  KNOWLEDGE_VERDICT.SUPPORTED,
];

const pct = (n) => `${Math.round(n * 100)}%`;

export function KnowledgeBadge({ result }) {
  if (!result) return <span className="text-xs text-slate-400">—</span>;
  const style = VERDICT_STYLE[result.verdict];
  return (
    <span className="inline-flex items-center gap-1.5" title={style.hint}>
      <FlagBadge tone={style.tone}>{style.label}</FlagBadge>
      {result.verdict !== KNOWLEDGE_VERDICT.CANNOT_CHECK && (
        <span className="tabular-nums text-[11px] text-slate-500">{pct(result.score)}</span>
      )}
    </span>
  );
}

/* The evidence, shown inside the expanded question. A verdict nobody
 * can check is just an assertion, so the page, the score and both word
 * lists are always on screen together. */
export function KnowledgeEvidence({ result }) {
  if (!result) return null;
  const style = VERDICT_STYLE[result.verdict];
  /* The space after each chip is real text, not margin: these lists get
   * copied into tickets and read by screen readers, and margin alone
   * makes "submit vehicle requisition form" one unreadable word. */
  const words = (list, tone) =>
    list.length === 0 ? <span className="text-slate-400">none</span> : list.map((w) => (
      <React.Fragment key={w}>
        <span className={`inline-block rounded px-1 py-0.5 font-mono text-[11px] ${tone}`}>{w}</span>{" "}
      </React.Fragment>
    ));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-semibold text-slate-700">Knowledge check</span>
        <KnowledgeBadge result={result} />
      </div>
      <p className="mb-2 text-slate-600">{style.hint}</p>
      {result.terms.length > 0 ? (
        <div className="space-y-1">
          <div>
            <span className="text-slate-500">Best-matching page: </span>
            {result.pageName
              ? <span className="font-mono text-slate-800">{result.pageName}</span>
              : <span className="text-slate-400">no page scored above zero</span>}
            {result.pageFile && <span className="text-slate-400"> · from {result.pageFile}</span>}
          </div>
          <div>
            <span className="text-slate-500">Question words found: </span>
            {words(result.matched, "bg-emerald-50 text-emerald-800")}
          </div>
          <div>
            <span className="text-slate-500">Not found: </span>
            {words(result.missing, "bg-rose-50 text-rose-700")}
          </div>
          {result.answerScore !== null && (
            <div>
              <span className="text-slate-500">The agent's own reply matches that page: </span>
              <span className="tabular-nums text-slate-800">{pct(result.answerScore)}</span>
              <span className="text-slate-400">
                {" "}— low with a high question score means the page is on the subject but the reply's specifics are not on it
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-slate-500">
          The question has no words specific enough to search on once openers and filler are removed.
        </div>
      )}
    </div>
  );
}

/* The panel owns the uploaded file and nothing else. It hands the index
 * up and the verdicts come back down, because question ids are
 * positional: a later import renumbers them, and a stored result would
 * then describe questions that have moved. Keeping the check derived
 * makes that staleness impossible rather than something to remember. */
export default function KnowledgePanel({ index, onIndex, counts }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const load = async (fileList) => {
    const files = [...fileList].filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (files.length === 0) {
      setError("Pick the knowledge Markdown file — the AI file, or a Master file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      const built = indexKnowledge(texts);
      if (built.pageCount === 0) throw new Error("No pages found in that file. Is it a generated knowledge file?");
      onIndex(built);
    } catch (e) {
      setError(e.message || String(e));
      onIndex(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <BookOpen className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">Knowledge check</span>
        <div className="ml-auto flex items-center gap-2">
          {index && (
            <button
              onClick={() => onIndex(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {busy ? "Checking…" : index ? "Replace file" : "Add knowledge MD file"}
          </button>
        </div>
        <input
          ref={inputRef} type="file" multiple accept=".md,.markdown,.txt" className="hidden"
          onChange={(e) => load(e.target.files)}
        />
      </div>

      <div className="p-4">
        <p className="mb-3 text-sm text-slate-600">
          Compares every consolidated question against the knowledge file the agent answers from, so a question nobody
          got an answer to can be told apart: <span className="font-medium">content missing</span> from the file, or
          content that is in the file and was never found.
        </p>

        {!index && (
          <p className="text-xs text-slate-500">
            Add the <span className="font-mono">_AI_File.md</span> for the corpus — that is the representation the agent
            retrieves from. A <span className="font-mono">_Master_File.md</span> also works: its pages are run through
            this app's own extractor first, so the raw source is never searched directly. Several files can be added at
            once.
          </p>
        )}

        {error && (
          <p className="flex items-start gap-2 text-xs text-rose-700">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {index && counts && (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              {HEADLINE.map((v) => (
                <div key={v} className="rounded-lg border border-slate-200 px-3 py-2" title={VERDICT_STYLE[v].hint}>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">{counts[v]}</div>
                  <div className="text-[11px] text-slate-500">{VERDICT_STYLE[v].label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1 text-xs text-slate-500">
              <div>
                Indexed <span className="font-medium text-slate-700">{index.pageCount} pages</span> from{" "}
                {index.sources.map((s) => `${s.file} (${s.format})`).join(", ")}.
              </div>
              <div>
                {counts[KNOWLEDGE_VERDICT.WEAK_MATCH]} weak match
                {counts[KNOWLEDGE_VERDICT.WEAK_MATCH] === 1 ? "" : "es"} and{" "}
                {counts[KNOWLEDGE_VERDICT.CANNOT_CHECK]} not checkable.
              </div>
              {index.noText.length > 0 && (
                <div className="text-amber-700">
                  {index.noText.length} page{index.noText.length === 1 ? "" : "s"} carry no searchable text and were
                  indexed as empty, so they cannot match anything: {index.noText.slice(0, 5).join(", ")}
                  {index.noText.length > 5 ? ", …" : ""}
                </div>
              )}
              <div className="pt-1 text-slate-400">
                {KNOWLEDGE_CHECK_RULE} A page counts as carrying the answer at {pct(COVERED_AT)} of the question's
                informative words, and as a weak match at {pct(WEAK_AT)}.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
