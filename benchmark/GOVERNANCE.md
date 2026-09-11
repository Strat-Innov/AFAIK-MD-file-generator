# Benchmark governance

How a corpus becomes a benchmark, what can stop it, and what may never be
rewritten once it has been measured.

This document exists because the September 2026 V1 run was scored against
a page that was wrong at source, and nothing in the pipeline was capable
of noticing.

---

## 1. The September V1 lesson

`South-Station-Terminal(test).aspx` carried the title **South Station
Transport Terminal** over a body copied from **Two Botanika**: residential
unit pricing, Botanika amenities, and a Socials block whose every branded
link said Botanika.

The question builder did its job faithfully and produced 34 questions
(q0525–q0558) asserting Botanika's facts as South Station's. All three
arms then faithfully reproduced a page that was wrong, and the benchmark
scored them against the contaminated values — penalising the arms that
correctly refused.

The generator is a faithful transform. **A faithful transform of a wrong
page is a wrong page.** No downstream check can catch that, which is why
the check belongs at the point where source becomes ground truth.

The page has since been deleted at source. It is **not** on an exclusion
list — there is nothing left to exclude.

---

## 2. Snapshot lifecycle

Five distinct things, deliberately not conflated:

| Concept | Where it lives |
|---|---|
| Source corpus | `test/corpus/` (active) · `benchmark/corpora/<snapshot>/` (archived) |
| Generated Master (Arm B) | `benchmark-artifacts/<snapshot>/arm-b/` |
| Generated AI (Arm C) | `benchmark-artifacts/<snapshot>/arm-c/` |
| Benchmark question set | `benchmark/question-set.json` (active) · `benchmark/history/<snapshot>/` |
| Historical snapshot | an entry in `src/lib/snapshots.js` |

`src/lib/snapshots.js` is the single source of truth. Nothing else in the
codebase carries a snapshot constant — not the UI, not the CSV exporter,
not the tests. The exporter learned this the hard way: hand-pinned to
August's checksum, it refused the September set outright.

### Statuses

- **`frozen`** — the current corpus. Exactly one, enforced at module load.
- **`historical`** — executed and audited. Its numbers are evidence.
- **`superseded`** — replaced, without a completed run.

### Registering a snapshot

1. Archive the pages under `benchmark/corpora/<name>/`.
2. Read `contentSha256` and `fileSetSha256` off the Benchmark screen —
   they are shown for an unregistered corpus precisely so this step needs
   no extra tooling.
3. Add the entry, with the artifact digests and source-unit count, and
   move the previous `frozen` entry to `historical` or `superseded`.
4. Run `npm test`. Every archived snapshot is rebuilt and checked against
   the digests recorded for it.

### Regenerating the benchmark after a source change

```
# 1. the active corpus follows the source
rm "test/corpus/<deleted page>.aspx"

# 2. regenerate — never hand-edit the question set
node scripts/build-question-set.mjs

# 3. rebuild the arms, then register the new digests
npm run benchmark:arms

# 4. export, dynamically batched from whatever the registry pins
node scripts/export-question-csv.mjs
```

Question ids are positional and are reassigned on every rebuild. **V1 ids
do not map onto V2 ids.** Cite a question by snapshot *and* id, or by its
text.

---

## 3. Historical immutability

**A completed benchmark is never recomputed.**

September V1's 641 questions, its `CORE_SHA`
`40befe1d18c3c75bbe6d8e1f502e6dee2437e53ac40cb4871f17920015465d33`, its
corpus digest and its arm digests stay exactly as recorded, and its name
stays `SEPTEMBER-2026-CORPUS` because the archived Master file's own
header carries that string — renaming it would break reproduction.

Its results are stored on the registry entry and displayed under
**Historical benchmarks** in the app, never mixed into the current
snapshot's panel.

A historical run describes the corpus it ran on and nothing else. September
V1's numbers are **not** a baseline for V2: different corpus, different
question population, different ids.

---

## 4. Source-integrity governance

`src/lib/sourceIntegrity.js`. Deterministic and literal — it asks no model
anything, because governance that cannot be reproduced is not evidence.

| Severity | Rule | Effect |
|---|---|---|
| **high** | `draft-page-marker` — the filename says `(test)`, `(copy)`, `(draft)`, `(wip)`, `(tmp)`, `(old)`, `(backup)` | **Blocks** benchmark generation |
| **medium** | `title-vs-linked-entity` — every branded external link names another entity that is itself a page in this corpus | Warns |
| **low** | a partial link mismatch, or `title-absent-from-body-headings` | Informational |

### Why the link rule cannot be "high"

`ARBORAGE.aspx` has the identical shape — every branded external link
names Brentville, and `BRENTVILLE.aspx` is a real page — yet Arborage's
body is genuinely Arborage. Measured over the 134-page V1 corpus, the link
rule at high confidence produced **two false positives** (ARBORAGE, PRIME)
against one true positive. So it warns.

What *is* certain is the filename. A page that announces itself as a draft
has no business supplying benchmark ground truth whatever its body says.
That check has no interpretation in it, so it is the one that blocks.

Override a reviewed high-confidence finding with
`node scripts/build-question-set.mjs --allow-source-warnings`. The
override is recorded in `meta.sourceIntegrity.overridden`.

Ordinary Master/AI generation is never blocked. This gates **benchmark
inclusion** only, where a wrong page becomes wrong ground truth.

---

## 5. Question-quality governance

`src/lib/questionQuality.js`. Warnings for review before a set is frozen.
**Nothing here rewrites a question** — silently repairing generated data
would destroy the property that makes the set usable: that every question
and answer came verbatim from the page.

| Severity | Rule |
|---|---|
| high | `empty-ground-truth`, `duplicate-question-id`, `question-references-absent-page` |
| medium | `spec-row-as-amenity`, `quantity-asked-nonnumeric-source` (when the source value asserts no fact) |
| low | `source-value-is-a-non-answer` |

High severity blocks the build. Everything else is reported and recorded
in `meta.questionQuality`.

Run against the cleaned corpus, this independently rediscovered all six
question defects the V1 audit found by hand: the five specification rows
scraped under an amenities heading, and the "how many … / Countless" pair.

---

## 6. Evaluation result lifecycle

`src/lib/evaluationResults.js`. Four buckets, and the raw string always
survives beside them:

```
PASS   FAIL   ERROR   OTHER
```

**No conversion is ever performed.** Not `empty → Fail`, not
`Error → Fail`, not `Error → Pass`.

Arm C row q0197 came back with an empty verdict *and* an empty response:
the evaluator never judged it. Folding that into Fail would report a
retrieval failure that did not happen; folding it into Pass would invent a
result. It is `OTHER`, and it counts in the denominator.

`classifyRow` additionally separates dispositions the audit had to
untangle by hand:

| Disposition | Meaning |
|---|---|
| `evaluated` | a verdict was reached on an answer |
| `evaluator-error` | the evaluator itself errored |
| `platform-error` | the *agent* failed — "response too large to handle", "Responsible AI restrictions" — and the evaluator scored the crash as an ordinary Fail |
| `incomplete-evaluation` | no verdict and no answer; nothing ran |
| `unrecognised-verdict` | a value this code has never seen — look at the row |

Seven Arm A rows in V1 were platform errors scored as retrieval failures.
That distinction is only visible from the agent's response text, so that
is where it is detected.

### Multiple evaluation methods

V1 used exactly one — Copilot's **General quality**, which scores
answered / on-topic / grounded and **never compares the answer to
`expectedResponse`**. That is why 8 Arm B and 2 Arm C rows passed with the
wrong person or the wrong URL.

The fix is not to drop General Quality but to stop the data model assuming
it is the only one. A row carries results **per method**:
`general_quality`, `answer_correctness`, `url_correctness`,
`entity_grounding`. Absent methods are absent, never defaulted — so "not
measured" can never read as "failed".

---

## 7. Raw vs adjudicated

Two layers. **Adjudication never overwrites a raw result.**

- **Layer 1 — raw.** Exactly what the evaluator emitted. This is what gets
  published as the official result.
- **Layer 2 — adjudication.** A human or audit classification recorded
  *beside* the raw value, carrying its evidence and reason.

`tally()` reports both at once, so a report can say "raw Pass, adjudicated
FAIL" for a confidently wrong answer — which is exactly what Arm B q0338
was: the evaluator passed it, the source says a different person.

Every adjustment must be traceable to a specific question id and its
evidence. An adjudicated score that cannot name its changed rows is not a
result.

---

## 8. Current state

| | September 2026 V1 | September 2026 V2 |
|---|---|---|
| Registry name | `SEPTEMBER-2026-CORPUS` | `SEPTEMBER-2026-V2-CORPUS` |
| Status | historical | frozen (current) |
| Source files | 134 | 133 |
| Benchmark pages | 128 | 127 |
| Questions | 641 | 607 |
| `CORE_SHA` | `40befe1d…` | `1f93c4a5…` |
| Corpus content SHA | `b12d87b7…` | `212e998c…` |
| Arm B SHA | `409af018…` | `bb5f8eda…` |
| Arm C SHA | `b0408d31…` | `65e8001f…` |
| Source units | 4,864 | 4,779 |
| Evaluation | complete — 1,923 evaluations | **NOT YET EVALUATED** |

September V1 remains a historical record. The defective South Station test
page is no longer part of the active corpus.
