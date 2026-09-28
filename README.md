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
| DERIVED | Clean Knowledge, Knowledge Gaps *(planned)* | AI candidates, validated against the raw layer and reviewed by a person before export. |

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

  | Status | When | Usable as answer evidence | Needs review |
  |---|---|---|---|
  | `ANSWERED` | A normal agent reply | Yes | No |
  | `TRUNCATED` | The exporter cut a message off (≥480 characters ending in `...`) | No | Yes |
  | `REDACTED` | A message is exactly `[REDACTED]` | No | Yes |
  | `NO_RESPONSE` | No agent message before the next user message or the end | No | Yes |
  | `AGENT_UNAVAILABLE` | Every reply is the usage-limit notice | No | No |

- `InitialUserMessage` is kept as reference only. The transcript is
  authoritative.

**Question first.** The user's question is the primary signal: it shows
what people expect AFAIK to know. The answer is context. Each record
also carries simple, rule-based metadata:

- **Answer type:** `KNOWLEDGE`, `NOT_FOUND`, `CONVERSATIONAL` or
  `SYSTEM_NOTICE`. It's set only where there's answer text, which means
  `ANSWERED` or `TRUNCATED`.
- **Question kind:** `INFORMATION_REQUEST` or `CONVERSATIONAL`.
  Conversational questions ("hi", "hmp") stay in the dataset but are left
  out of consolidation.
- **Potential knowledge gap:** an information request answered
  `NOT_FOUND`. It's a flag for review, not a confirmed gap.

**AI Consolidation, Pass 1 (preparation).** Builds a deterministic
package of every information request, with its exact question, answer
parts, status and type, plus a prompt asking Claude to group the
questions by information need. The prompt says every QA ID must appear
exactly once. Nothing is sent automatically: the user copies or
downloads the prompt. Importing and validating Claude's reply is the
next phase. The engine produces provider-neutral requests, and
`src/lib/responses/ai/provider.js` renders them. v1 has one provider, a
manual one, so another can be added without touching the UI.

**Privacy.** Everything runs in the browser. Session data is never
uploaded, never written to `localStorage`, and is gone when the tab
closes; the user's export is the only thing that persists. Real exports
must not be committed to this public repository (see
`test/responses/README.md`).
