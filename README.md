# AFAIK Configuration App

The configuration and maintenance workspace for AFAIK. It has two
capabilities:

- **Knowledge Source Configuration — ASPx → Markdown.** The original
  function of this app, unchanged and documented below.
- **Response Consolidator.** Imports AFAIK Agent session exports and
  turns real user questions into knowledge-base maintenance data. See
  [Response Consolidator](#response-consolidator).

## ASPx → Markdown Master File

Drop `.aspx` files (or a `.zip` of them) and get one combined Markdown
"master file" in the same format as your existing export. Everything runs
in the browser — no server, no upload, no database.

Built with React + Vite. ZIP unpacking uses the browser's native
`DecompressionStream`, so there are no runtime dependencies to install
beyond React.

## What it outputs
Two files per bucket, from the same source, for two different jobs.

**Raw `.md` — the fidelity layer.** Unchanged from before: for each
`.aspx` it emits the raw file in an ```aspx``` fence, then a
`### Content Overview` with the page's ContentTypeId, PageLayoutType, and
the `CanvasContent1` decoded one HTML-entity pass. Files are listed in a
table of contents and sorted case-insensitively by name. This is the
source-of-truth copy — use it for audit, diffing and rollback.

**AI `.md` — the retrieval layer.** A much smaller document per page,
built for Copilot Studio knowledge retrieval. It keeps the user-visible
information (headings, prose, prices, unit sizes, amenities, tables,
links, contacts, source metadata) and drops the SharePoint rendering and
implementation detail (web part GUIDs, canvas positions, asset paths,
CSS classes). On the three sample pages this is a ~98% size reduction
with no loss of meaningful content.

Extraction is deterministic — a DOM walk over the page's own canvas
controls. There is no LLM anywhere in the transformation path, nothing
is summarized or paraphrased, and the same input always produces the
same output.

## The validation gate
An AI file is only downloadable if it passes coverage validation:

```
Source ASPX ──> source content units ─┐
                                      ├─> compare ──> PASS -> publish
Optimized MD ─────────────────────────┘         └──> FAIL -> blocked
```

A *content unit* is one atomic piece of information: a line of prose, a
list item, a table cell, a price, a link URL, a person's name. The gate
derives the source's units independently of the parser it is checking —
by a different technique — so a parser bug that silently drops a
paragraph still fails the gate. Comparison is normalized, so Markdown
syntax, whitespace, heading depth, bullet style, quote/dash variants and
non-breaking spaces never cause a false failure, but an omitted value
does.

Failures name the values, not just a boolean:

```
VALIDATION
----------
Status: FAIL

Source content units: 99
Represented content units: 96
Missing units: 3

Missing content:
- "₱44.9M"
- "125–146 sqm"
- "South Luzon"
```

The raw master file is never gated — it stays downloadable precisely
when something has gone wrong with the optimized one.

## Status

The generator is **frozen at v1.0.0** (2026-08-28). See
[GENERATOR-CONTRACT.md](GENERATOR-CONTRACT.md) for what it guarantees,
what it does not, the validated baseline over the 133-page August
corpus, and the protocol for changing it. Each AI file records the
generator version in its `## Source` block.

## Tests
```bash
npm test
```
Covers raw-source fidelity (byte-for-byte round-trip through the fence),
extraction against the three real exported pages in `test/fixtures/`, and
the gate's ability to detect missing and invented content.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. Vercel → New Project → import the repo.
3. Framework preset: **Vite** (auto-detected). Build `npm run build`, output `dist`.
4. Deploy.

## Known limitations
- Team role labels (MARKETING, SALES, …) are separate canvas controls
  from the People web parts they visually sit beside, and SharePoint's
  stored control order does not reliably pair them. They are emitted in
  source order rather than guessed into pairs. Each person still carries
  their own role, so retrieval is unaffected.
- Table extraction has no real-world fixture yet — none of the sample
  pages contains a `<table>`. It is covered by a synthetic test only.
- Copilot Studio retrieval improvement has not been benchmarked. The
  optimized file is smaller and cleaner; whether that improves answer
  quality or latency needs measuring against a real question set.

## Notes
- The `Path:` line uses each file's name; the original absolute Windows
  path can't be reproduced in a browser. Change the prefix in `src/App.jsx`
  (`buildSection`) if you want a fixed one like `input\name.aspx`.
- Requires a modern browser (Chrome/Edge/Firefox/Safari) for
  `DecompressionStream` (deflate-raw).

## Response Consolidator

Turns AFAIK Agent session exports into knowledge-base maintenance data.
Open **Response Consolidator → Import Responses** in the sidebar and
drop one or more session exports (CSV or XLSX; several at once).

The data is kept in layers, and a derived layer never writes back into
the one below it:

| Layer | View | What it is |
|---|---|---|
| **RAW** | Raw Sessions | Every imported row, exactly as exported, with its source file and row number. Read-only. |
| RAW | Extracted Q&A | One record per user message, read deterministically from the transcript. The question and every agent answer part are kept word for word. |
| DERIVED | Question Consolidation | Real questions merged into clean questions, reviewable against the originals, and exported to Excel. |

**Import rules**

- Columns are matched by name (`SessionId`, `StartDateTime(UTC)`,
  `ChatTranscript`, …), with spacing and casing ignored. Unrecognised
  columns are kept with the session.
- A session that appears in two exports (overlapping date ranges) is
  one session with both sources listed. The same `SessionId` with
  different content is kept twice and flagged, never silently resolved.
- A file dropped twice is recognised by its content and skipped.
- Legacy binary `.xls` isn't supported; save as `.xlsx` or `.csv`.

**Extraction rules** (`src/lib/responses/transcript.js`, `qa.js`)

- Transcripts are `<Speaker> says: <text>;` entries. Only `User says`
  and `Agent says` are speakers; `Bot said:` inside an agent message is
  message text. The parsed entry count must equal the `Turns` column,
  otherwise the session is flagged `PARSE_MISMATCH`. Unknown speakers and
  text outside any entry are kept and flagged, never dropped.
- Each user message is one Q&A record. Its answer is the agent messages
  that follow, up to the next user message, kept as ordered parts.
  Agent messages before the first question are session preamble.
- Every answer gets a status taken from the transcript text, never from
  `SessionOutcome`:

  | Status | When | Transcript completeness | Needs review |
  |---|---|---|---|
  | `ANSWERED` | A normal agent reply | `COMPLETE` | No |
  | `TRUNCATED` | The exporter cut a message off (≥480 characters ending in `...`) | `TRUNCATED` | No |
  | `REDACTED` | A message is exactly `[REDACTED]` | `NONE` | Yes |
  | `NO_RESPONSE` | No agent message before the next user message or the end | `NONE` | Yes |
  | `AGENT_UNAVAILABLE` | Every reply is the usage-limit notice | `NONE` | No |

  Answer status describes the interaction and the export, **never
  whether the answer was correct**.

  - `TRUNCATED` only means the export has a character limit. The question
    is fully valid and always goes to intent consolidation, and the
    visible text is kept as context. The missing part is never
    reconstructed.
  - Correctness is a separate field, `knowledgeValidation`. It is judged
    against the validated AFAIK knowledge source, not the transcript.
    Every record starts `NOT_EVALUATED`.

- `InitialUserMessage` is kept as reference only. The transcript is
  authoritative.

**Purpose.** The Response Consolidator shows what AFAIK users are
actually asking. It keeps those real questions, turns repeated and
reworded ones into clean reusable questions, and exports that question
master for improving AFAIK. Answer evaluation is supporting information.

**Information vs conversational.** Greetings and filler ("hi", "hmp") are
kept in Raw Sessions and Extracted Q&A, but they aren't knowledge
questions and aren't consolidated. On the September 2026 exports that's
49 Q&A records: 42 information questions and 7 conversational.

**Question Consolidation** is built in (`src/lib/responses/consolidate.js`).
It doesn't use AI and has no round-trip, so the export is available as
soon as files are imported.

- **Grouping.** Information questions are merged when their wording is
  identical apart from case, spacing and punctuation. Reworded questions
  stay separate. Every information question appears in exactly one
  consolidated question.
- **Clean question.** The original wording, tidied: extra spaces
  removed, first letter capitalised, a question mark added. It is never
  reworded and nothing is added.
- **Answer result.** Taken from the transcript only:

  | Result | When |
  |---|---|
  | `NOT_ANSWERED` | Agent unavailable, no reply, or an explicit "could not find" |
  | `CANNOT_DETERMINE` | A redacted reply, or one cut off by the export (truncation isn't "not answered") |
  | `ANSWERED` | Otherwise |

  A question asked several times is `ANSWERED` if any attempt was
  answered, otherwise `CANNOT_DETERMINE` if any attempt can't be judged,
  otherwise `NOT_ANSWERED`. The notes say what each attempt got.
- **Review.** Each clean question expands to its original questions
  exactly as asked, the agent's answers, answer status, timestamps and
  source files. Each QA ID links to its Extracted Q&A record, which links
  to its raw session and source row.
- **Export Consolidated Excel** → `AFAIK_Question_Consolidated.xlsx`:

  | Sheet | Contents |
  |---|---|
  | `RAW_Q&A` | Every Q&A record, values exactly as imported, plus the consolidated question each one went into |
  | `CONSOLIDATED_QUESTIONS` | Question ID, clean question, occurrence count, original QA IDs, original questions, answer result, notes |
  | `SUMMARY` | Files, sessions, Q&A, information/conversational, consolidated and repeated questions, answer-result counts, consolidation method |

  The workbook is written in the browser with the app's own zip writer,
  with no dependency. Text is stored as text, so a question starting
  with `=` can't run as a formula.

The consolidation is recomputed from the current sessions and never
stored. The Excel export is the lasting record.

**Privacy.** Everything runs in the browser. Session data is never
uploaded, never written to `localStorage`, and is gone when the tab
closes; the user's export is the only thing that persists. Real exports
must not be committed to this public repository (see
`test/responses/README.md`).
