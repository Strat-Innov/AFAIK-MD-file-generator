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

> One determinism detail: `buildMaster()` stamps a generation time into
> its header, which would change Arm B's checksum on every run. The
> builder passes a fixed snapshot clock (`2026-08-31T00:00:00Z`) so the
> bytes are stable. Arm C carries no clock.

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
| **Knowledge source** | live SharePoint site only | SharePoint + consolidated MD | SharePoint + AI-optimized MD |
| **Files uploaded** | none | `arm-b/AUGUST-2026-CORPUS_Master_File.md` | `arm-c/AUGUST-2026-CORPUS_AI_File.md` |
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
  Arm B's file, or Arm C's file

Arms B and C use **identical packaging** — one consolidated file each,
covering the same 133 pages. That is deliberate: splitting one arm into
per-page files and not the other would confound representation with
chunking, and it would no longer be possible to say which caused a
difference.

Remove the previous arm's uploaded file before loading the next, and
confirm the agent's knowledge list is empty for Arm A.

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

**742 questions over 133 pages**, all with verbatim source answers. See
[`CURATION.md`](CURATION.md) for verified composition, known weaknesses,
and what to exclude or supplement before a headline number is quoted.

Read results **per category**, not as one aggregate. A difference of a
few percent across 742 questions is noise; a consistent difference
within `unit-price`, `unit-area` and `contact-by-role` is the signal,
because those depend on facts staying next to each other.

## 8. What this cannot tell you

Retrieval quality depends on Copilot Studio's own indexing and ranking,
which is outside this repository and can change without notice. A result
is a snapshot of one configuration on one day, not a property of the
generator. Re-run when the knowledge base is rebuilt, when the agent
configuration changes, or when the generator version changes.
