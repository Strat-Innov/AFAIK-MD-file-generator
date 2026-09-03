# Retrieval benchmark

The generator is frozen (see [`../GENERATOR-CONTRACT.md`](../GENERATOR-CONTRACT.md)).
What is still unmeasured is the thing the optimized file exists for:
**does it actually make Copilot Studio answer better?**

No benchmark has been run. No performance or latency claim is made
anywhere in this work, and none should be until one has.

---

## 1. Build the inputs

```bash
npm run benchmark:questions   # the ground-truth question set
npm run benchmark:arms        # the Arm B and Arm C knowledge artifacts
```

Both read `test/corpus/*.aspx` and write **gitignored** output — the
files reproduce the corpus, employee names and work addresses included.
Both are deterministic: re-running produces byte-identical results, and
`benchmark-artifacts/manifest.json` records a SHA-256 for each artifact
so a result can be tied to exactly the bytes that produced it.

`benchmark:arms` imports the frozen generator from `src/lib` rather than
reimplementing it, so the artifacts under test are the ones the app
itself emits.

### Or from the app: the **Benchmark** workspace

The same two artifacts can be produced without a checkout, a terminal,
or knowing this directory exists:

> Load the corpus → **Benchmark** in the sidebar → *Generate Benchmark
> Artifacts* → *Download Both* → upload to Copilot Studio.

There are two packagings, and the workspace offers both. Both hold
packaging constant across arms, which is what makes the comparison mean
anything.

#### The Copilot-safe package — recommended

`AUGUST-2026-COPILOT-BENCHMARK.zip`, **5 files per arm**:

```
ARM-B/  PROJECT-PLAYBOOK_Master.md   TOWNSHIP-PAGES_Master.md
        NAVIGATION-PAGES_Master.md   LOCATORS_Master.md
        LIFE-AT-FAI-PAGE_Master.md
ARM-C/  PROJECT-PLAYBOOK_AI.md       TOWNSHIP-PAGES_AI.md
        NAVIGATION-PAGES_AI.md       LOCATORS_AI.md
        LIFE-AT-FAI-PAGE_AI.md
manifest.json
```

This is **not** a size-driven split of the consolidated file. Each Arm B
file is the Master file that bucket already produces — the same
`buildMaster(bucket, files, clock)` call `buildOutputs()` makes,
differing only in the fixed snapshot clock — and each Arm C file is its
AI-optimized counterpart. Same buckets, same pages, same file count per
arm; representation is the only difference.

It exists because the tenant's *Add knowledge* upload refuses a file
above **16 MB**, and the consolidated Arm B is 37 MB. (Microsoft
documents 512 MB for an uploaded knowledge source and 16 MB for Code
Interpreter analysis; the upload path in front of us enforces the
smaller number.) Measured over the August corpus the largest file is
`NAVIGATION-PAGES_Master.md` at 13.52 MB — **80.6%** of the limit. Real
headroom, but not generous: a few more large pages in that one bucket
would push it over. The workspace refuses to hand over a package
containing an oversized file rather than letting it fail on the upload
screen.

Because the corpus carries no tag assignment, the partition is implicit
nowhere — the manifest records which pages went into which bucket, and a
result is reproducible only against the partition it was built from. The
workspace also refuses to build while any file is still **Unsorted**,
since those pages belong to no bucket and would otherwise be silently
left out.

#### The consolidated arms — alternative

`AUGUST-2026-CORPUS_Consolidated-Arms.zip`, one file per arm over all
133 pages. Its checksums are the frozen ones this work was verified
against, and it remains the right shape wherever a single large file can
be uploaded. Each arm can also be downloaded on its own, as can
`manifest.json`.

The workspace shows the snapshot identity (name, generator, clock, file
count, file-set SHA-256), a per-file table for the package (size,
percentage of the upload limit, SHA-256), and for the consolidated pair
one card per arm: filename, size, page
count, SHA-256, and for Arm C the coverage result with its
source / represented / untraceable unit counts. *Verify Artifacts*
re-derives both digests from the bytes in hand and reports whether they
still describe what the download buttons will produce — the check worth
having, since a stale number on screen is exactly what a person cannot
see. *Regenerate* rebuilds; if the staged files change after a build,
the result is marked stale and downloads are held until it is rebuilt,
so nothing leaves under an identity that was never displayed.

Arm B is offered whatever the validation says — it is the fidelity layer
and is most needed when the optimized one has gone wrong. Arm C, and
therefore *Download Both*, require a PASS.

The archive is written by `src/lib/zip.js`, a ~120-line writer over the
browser's native `CompressionStream` — the mirror of the
`DecompressionStream` the app already uses to read dropped zips, so
there is still no runtime dependency beyond React. It is deterministic:
entry timestamps come from the snapshot clock, not the wall clock.

It is an admin surface, deliberately outside the normal workflow: the
product is still the per-bucket Master files, and this page does not
touch them. The recipe itself lives in `src/lib/benchmarkExport.js` and
is shared, so the CLI and the button call the *same* function and cannot
drift; `test/benchmarkExport.test.js` asserts they agree byte-for-byte,
and that the archive's entries round-trip to the canonical digests.

> The panel compares what it built against the verified artifacts and
> says so on screen. A mismatch is reported, never enforced — building
> from a different corpus is legitimate, it just is not the run the
> pre-flight was designed against.
>
> One thing will trip it, and it is worth knowing before you press the
> button: **filename spelling**. One page of the corpus is named
> `PROJECT-DEVELOPMENT-–-PRIMING-&-INNOVATION.aspx`, with a real en
> dash. The browser reads that name straight off the ZIP entry and
> keeps it. Command-line `unzip`, extracting the same archive into
> `test/corpus/`, rewrites the character it cannot map as `#U2013` — so
> the CLI build, and therefore the canonical artifact, carries the
> escaped spelling.
>
> The page content is identical either way; the bytes of the name are
> not. Diffed against the canonical artifacts, a ZIP-dropped build
> differs on exactly three lines of Arm B (the table-of-contents entry,
> the `## heading`, the `Path:`) and one line of Arm C (`- Source
> file:`, inside the `## Source` block the gate excludes from
> coverage) — nothing else. So a ZIP-dropped build is a valid,
> deterministic pair of artifacts whose checksums are simply not the
> canonical ones. The file-set SHA-256 at the top of the panel tells you
> which input set you are on. Nothing normalizes the name — a filename
> is source metadata, and rewriting it to make a checksum agree would be
> the exact failure the checksum exists to catch.
>
> For the same reason, a ZIP whose pages sit inside folders records the
> folder in each section's `Path:` line, where a loose drop or the CLI
> records the bare filename. Same content, different provenance line,
> different checksum.

> One determinism detail: `buildMaster()` stamps a generation time into
> its header, which would change Arm B's checksum on every run. The
> builder passes a fixed snapshot clock (`2026-08-31T00:00:00Z`) so the
> bytes are stable. Arm C carries no clock.

> **Scope and pre-flight.** The benchmark now runs over a deliberately
> selected **128-page** subset of the 133-page snapshot, and the
> nine-question Copilot Studio pre-flight has been run.
> [`SCOPE.md`](SCOPE.md) records the selection, the five pages excluded
> by intent, and the regeneration of the question set from 742 to
> **638** against the 128. [`PREFLIGHT.md`](PREFLIGHT.md) records the
> pre-flight outcome.

## 2. The knowledge snapshot

Every arm is built from **one fixed set: all 133 August 2026 pages**.

The app groups files by tag when a person uses it, but the corpus
carries no tag assignment. Inventing one would add a second variable, so
the benchmark ignores tags entirely and treats the corpus as a single
snapshot named `AUGUST-2026-CORPUS`. The exact file list and its
SHA-256 are recorded in the manifest.

## 3. The three arms

| | Arm A | Arm B | Arm C |
|---|---|---|---|
| **Knowledge source** | live SharePoint site only | SharePoint + Master MD | SharePoint + AI-optimized MD |
| **Files uploaded** | none | the five `ARM-B/*_Master.md` files | the five `ARM-C/*_AI.md` files |
| **Pages represented** | 133 (live) | 133 | 133 |
| **Representation** | SharePoint's own indexing | raw `.aspx` in fences + decoded canvas | extracted user-visible content |

**Constant across all three arms — changing any of these invalidates the comparison:**

- the agent, its model, and its system instructions
- the question set, and the order questions are asked in
- the SharePoint site connection and its permissions
- temperature / determinism settings
- the person or script asking, and the scoring rules
- the corpus snapshot the artifacts were built from

**Varying — the single experimental variable:**

- the knowledge representation uploaded alongside SharePoint: nothing,
  Arm B's files, or Arm C's files

Arms B and C use **identical packaging** — five files each, cut on the
same production bucket boundaries, covering the same 133 pages. That is
deliberate: splitting one arm differently from the other would confound
representation with chunking, and it would no longer be possible to say
which caused a difference. The five-bucket shape is also what the app
actually produces, so the result speaks to the real workflow rather than
to a packaging that exists only for the experiment.

Remove the previous arm's uploaded files before loading the next — all
five — and confirm the agent's knowledge list is empty for Arm A.

## 4. Scoring

Row shape: [`result-schema.json`](result-schema.json). One row per
question per arm per repetition — 13 required fields:

`question_id`, `arm`, `question`, `expected_answer`, `copilot_answer`,
`correct`, `partial`, `retrieval_failure`, `hallucination`, `grounded`,
`citation_present`, `latency_ms`, `notes`.

`correct`, `partial` and `citation_present` are computed by
[`../scripts/lib/equivalence.mjs`](../scripts/lib/equivalence.mjs), so
two people scoring the same run reach the same verdict. The remaining
judgement flags are human: `retrieval_failure` ("I couldn't find that"),
`hallucination` (a confident, specific answer that contradicts the
source), and `grounded`.

Keep `retrieval_failure` and `hallucination` apart. A miss is a gap; a
confident wrong answer is a hazard, and averaging them into one
"incorrect" number hides the difference that matters most.

### Equivalence rules

Permissive about formatting, strict about values.

**Treated as the same answer**

| Rule | Example |
|---|---|
| URL encoding | `Shared%20Documents` = `Shared Documents` |
| Currency notation | `₱25.5M` = `PHP 25.5M` = `P25.5M` |
| Thousands separators | `1,000` = `1000` |
| Dash variants in ranges | `97–120` = `97-120` |
| Whitespace, case, non-breaking spaces, Markdown decoration | `**₱28.8M**` = `₱28.8m` |
| Answer embedded in prose | `The floor area is 97-120 sqm.` matches `97–120 sqm` |

**NOT treated as the same answer**

| Rule | Example |
|---|---|
| Any different digit | `₱28.8M` ≠ `₱28.9M` |
| Different units | `97–120 sqm` ≠ `97–120 sqft` |
| Half of a range → `partial`, never `correct` | `₱25.5M` for `₱25.5M – ₱27.3M` |
| Trailing zeros | `25.5` ≠ `25.50` — a numeric judgement, not a formatting one |
| Substring inside a longer word | `LEASING` is **not** found in `subleasing/assignment` |

That last rule is not hypothetical. During generator validation a
substring check passed a page that had genuinely lost its `LEASING`
heading, because the page contained `subleasing/assignment` elsewhere.
Matching here is on runs of whole tokens for the same reason — the same
mistake would silently inflate every arm's score.

## 5. Latency

Record `latency_ms` where wall clock is reliably measurable. Record
transport failures and timeouts as `request_failed` and **exclude them
from correctness rates** — never score them as incorrect.

Latency is secondary. The primary outcome is answer correctness. Do not
report a latency difference as an improvement without repeated
measurements, and do not report it at all if the arms were run under
different network conditions.

## 6. Reproducibility

| | |
|---|---|
| **Question ordering** | fixed — ascending `question_id`, exactly as stored |
| **Randomization** | none. If shuffling is ever introduced, record the seed |
| **Repetitions** | ≥ 3 per question per arm; report per-run and aggregate. A single pass cannot separate a real difference from model variance |
| **Conversation state** | **one fresh conversation per question.** Never ask a follow-up |
| **Isolation** | record `conversation_id` per row as evidence of isolation |
| **Knowledge snapshot** | `manifest.json` — snapshot name, file list, per-artifact SHA-256 |
| **Generator version** | `GENERATOR_VERSION`, also stamped in every optimized document's `## Source` block |
| **Agent configuration** | capture agent name, model, instructions and settings before the first arm, and re-verify after the last |

Asking all questions in one conversation is the most likely way to spoil
this run: earlier answers stay in context and later questions get
answered from conversation history rather than from retrieval, which is
the exact thing being measured.

## 7. The question set

**638 questions over the 128 in-scope pages**, all with verbatim source answers. See
[`CURATION.md`](CURATION.md) for verified composition, known weaknesses,
and what to exclude or supplement before a headline number is quoted.

Read results **per category**, not as one aggregate. A difference of a
few percent across 638 questions is noise; a consistent difference
within `unit-price`, `unit-area` and `contact-by-role` is the signal,
because those depend on facts staying next to each other.

## 8. What this cannot tell you

Retrieval quality depends on Copilot Studio's own indexing and ranking,
which is outside this repository and can change without notice. A result
is a snapshot of one configuration on one day, not a property of the
generator. Re-run when the knowledge base is rebuilt, when the agent
configuration changes, or when the generator version changes.
