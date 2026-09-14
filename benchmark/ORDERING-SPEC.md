# Canvas ordering contract — candidate specification

**Status: CANDIDATE. Frozen for review. Not implemented, not authorized.**

This document fixes the proposed reading-order algorithm in writing so that
implementation cannot quietly evolve it. Nothing here changes the extractor,
the registry, or any frozen snapshot. `SEPTEMBER-2026-V2-CORPUS` remains
frozen at 607 questions, CORE_SHA `1f93c4a5…`, `evaluation: not-run`.

---

## 1. The assumption under investigation

`src/lib/aspxDocument.js` states:

> *"Document order matches the controls' zone/section/control indices, so
> canvas order is reading order and each control is a section."*

`parsePage` never reads `position`; it emits sections in DOM order. The
first half of the claim holds — DOM order equals the legacy
`(zoneIndex, sectionIndex, controlIndex)` sort on **133/133** pages of the
registered V2 corpus. The second half — that this is *reading* order — is
what is in question.

A modern SharePoint page also carries `flexibleLayoutPosition.lg`
(`{x, y, w, h}`), a sibling of `position`, on 1256 of 1704 content controls
across 132 of 133 pages. Only the `lg` breakpoint exists in this corpus, so
there is no responsive-ordering ambiguity to resolve. The two layers
disagree on **139 of 247** comparable multi-control zones.

---

## 2. The contract

Named `bandedColumnByTop`.

```
order(page):
  emit zones in (zoneIndex, sectionIndex) order        # unchanged
  for each zone: emit order(zone)

order(zone):
  1. if ANY control in the zone lacks flexibleLayoutPosition.lg
       -> return the zone in legacy controlIndex order      # fallback
  2. W    := max(x + w) over the zone
     rule := a control with w >= 0.9 * W AND h == 0         # a divider
  3. if no rule exists -> return columns(zone)
     else: rules split the zone into horizontal BANDS by their y;
           emit each band via columns(), with each rule emitted in place
  columns(controls):
  4. a. cluster controls whose [x, x+w) spans OVERLAP into columns
     b. order columns by the y of their topmost control
     c. tie-break by left edge (x)
     d. tie-break by right edge (x + w)
     e. within a column, order by (y, x, controlIndex)
```

### Invariants

- **Total and deterministic.** Every comparator terminates in
  `controlIndex`, which is unique within a zone. The same input always
  produces the same order.
- **Degenerate cases reduce correctly.** A single-column zone reduces to
  plain `y` order. A zone without coordinates reduces to legacy order,
  byte-identically.
- **Ordering is never inferred from content semantics.** No rule may read
  heading text, role names, web-part type, or any other meaning. Position
  and geometry only.
- **Source is never modified.** The contract describes how the extractor
  *reads* a page. It never licenses an edit to a SharePoint page.
- **Corpus identity is untouched.** `contentSha256` and `fileSetSha256`
  hash raw bytes; a parse-order change cannot move them.

### Rejected alternatives

| policy | why rejected |
|---|---|
| legacy / DOM order | see §3 |
| `rowMajor` (sort by y, then x) | interleaves multi-column layouts; `spec-row-as-amenity` findings rise 5 → 21 |
| `columnMajor` (columns by left edge) | a hero image in a left column outranks the page title in a right column — one entity regression |
| `bandedColumnMajor` | same regression; fixed by ordering columns by topmost `y` (4b) rather than by left edge |

---

## 3. Evidence supporting the candidate

Measured against the registered V2 corpus (`contentSha256` verified
`212e998c…`), using the production parser in an isolated copy. The patched
parser is a verified no-op under the legacy policy — it reproduces
`1f93c4a5…` exactly.

**Title placement** — of 85 pages whose title heading sits in a comparable
zone: first under both 65; **only under flexible 13; only under legacy 0**;
under neither 7.

**Heading + people-webpart zones** — 71 corpus-wide: heading first under
legacy **60/71 (84.5%)**, under flexible **71/71 (100%)**.

**Entity derivation** — 17 pages derive a different entity, with **zero
regressions**. Nine pages whose entity resolved to a section heading
meaning "Purpose" and six to "Overview:" resolve instead to their own
page title.

**Question-quality findings** — `spec-row-as-amenity`: legacy 5,
`rowMajor` 21, **candidate 1**.

**Question set** — 607 → 636; CORE_SHA `1f93c4a5…` → `8a43db57…`.

```
added   43   removed 14   common 593
   ANSWER changed (ground truth moved) : 0
   same answer, minted id moved only   : 553
```

The 43 additions are amenity questions on six pages whose amenity lists the
legacy ordering did not recognise at all (two such pages produced **zero**
amenity questions despite presenting an amenity list); the 14 removals are
10 re-attributions plus 4 demonstrably defective questions built from
pricing rows grouped under an Amenities heading.

> **Recorded conclusion (Gate 2, PASSED):** Flexible-layout ordering
> recovers previously missed genuine amenity content while removing known
> pricing-row false positives, with the remaining 10 removals/additions
> attributable solely to entity/rephrasing changes. No evidence currently
> indicates that the 43 additions are artifacts introduced by reordering.

### Stated at the strength the evidence supports

> Legacy ordering produces 17 entity derivations that are inconsistent with
> the page-title/section structure under the proposed flexible-layout
> interpretation, with zero corresponding regressions in the corpus
> experiment.

All of the above is corpus-internal consistency evidence. None of it
observes what SharePoint actually renders.

---

## 4. Downstream impact

| artifact | effect |
|---|---|
| Master MD / **Arm B** | **byte-identical** — a raw `.aspx` carrier. Verified `bb5f8eda…` under both policies. |
| Corpus digests | **unchanged** — parse order is not source content |
| **Arm C** | **fully order-dependent** — it is `generateOptimized()`, which calls `parsePage`. 89 of 133 pages change digest. |
| Question set | 607 → 636, new CORE_SHA `8a43db57…` |
| Generation run | new run id |

**Arm C is currently suppressed entirely by the coverage failure in §5.**
`benchmarkExport.js` gates Arm C on coverage: on a FAIL, `armC.md` is empty
and `armC.sha256` is null. Under the candidate policy Arm C hashes to
`e3b0c442…` — the digest of the empty string — because one page fails the
inter-control ordering check.

This makes §5 a hard prerequisite, not a cleanup: until Invariant B is
re-based, the candidate policy produces **no Arm C at all**. An earlier
draft of this table stated that Arm C was unaffected; that was wrong, and
only Arm B is.

---

## 5. The coverage invariant (accepted design, not implemented)

`src/lib/coverage.js` conflates two guarantees:

- **Invariant A — intra-control.** Prose within one RTE control must remain
  monotonic. Genuinely independent of ordering policy. **Keep unchanged.**
- **Invariant B — inter-control.** Content must appear in the order the
  parse emitted. Circular while DOM order is the thing under investigation.
  **Re-base on the canonical policy order.**

Re-basing does not weaken coverage; it changes what coverage proves. It
still catches dropped, duplicated, missing, invented and transposed units,
and intra-RTE corruption. It stops silently answering "is DOM order reading
order?", which is the open question.

One page currently fails under the candidate with `missing=0, unmatched=0`:
its failing unit moves from 11th to 5th across controls while remaining
monotonic within its own control — a pure Invariant-B effect. That single
page failure suppresses Arm C for the whole corpus (see §4).

The existing `test/ordering.test.js` suite (14 tests) **passes unchanged**
under the candidate policy. Those tests perturb the rendered Markdown while
holding the parse fixed, so they assert that the renderer must not transpose
what the parser produced — never that DOM order is reading order. Re-basing
Invariant B therefore does not require weakening any existing test.

---

## 6. Question identity (decided)

> Question IDs remain sequential and extraction-order-derived for V3.
> Content-derived IDs are explicitly deferred as a separate future
> migration. Cross-version ID stability is not currently a system
> invariant. No ID migration is included in the V3 ordering change.

Rationale: an ordering change and an identity-scheme change would both move
the CORE_SHA, and a single lineage step must have a single attributable
cause.

A content-derived scheme `q-sha256(page|kind|question)[:10]` has been
measured as viable — collision-free at 607/607 and 636/636, sharing 593 ids
across the two sets, matching the 593 common questions exactly — and is
recorded here only as a future option.

---

## 7. Gates

| gate | status |
|---|---|
| 1 — rendered-page visual ground truth | **OPEN** — requires screenshots; cannot be closed from metadata |
| 2 — 57-question semantic diff | **PASSED** |
| 3 — coverage invariant | **DESIGN ACCEPTED / IMPLEMENTATION PENDING** |
| 4 — question identity | **DECIDED** — sequential ids retained |
| 5 — V3 authorization | **NOT AUTHORIZED** |

Implementation may begin only after Gates 1 and 3 are closed. V3 is a new
lineage: V2 is never mutated.

---

## 7b. Full-suite impact, measured

Running the repo's own suite in the isolated lab, controlling for 7 failures
caused by the lab not being a git checkout:

```
legacy policy   : 312 passed,  7 failed (all git-dependent lab artifacts)
candidate policy: 297 passed, 22 failed  ->  15 real failures
```

Of the 15: **8 assert the frozen V2 identity** (question count, CORE_SHA,
canonical artifact bytes, rebuild determinism, archive round-trip) and are
expected to change under any new lineage. The other **7 all trace to the
single coverage failure in §5**, because it empties Arm C and every Arm C
assertion then fails downstream of it.

No failure indicates a defect in the ordering contract itself.

---

## 8. Validation required before implementation is accepted

- Fixture tests pinning the worked zones (a 2-column title/hero zone, a
  3-column spec zone with and without a full-width rule, a heading+people
  zone, a 2x2 card grid, and the column-by-top regression case).
- Corpus-wide regression: 636 / `8a43db57…`, 17 entity corrections, 0 entity
  regressions, **0 changed answers among common questions**.
- Semantic association: heading-first in all 71 heading+people zones;
  `spec-row-as-amenity` <= 1.
- Fallback: the 2 mixed-coordinate zones, and a synthetic zone with no
  coordinates, must match legacy exactly.
- Ties and overlaps: equal `y`, equal `x`, zero width, zero height, and
  full-zone-spanning controls.
- Multi-column zones at every observed `sectionFactor` (4, 6, 8, 12, 100).
- A guard asserting that a non-`lg` breakpoint, if one ever appears, takes
  the fallback rather than being silently used.
- Idempotence: the legacy policy still reproduces `1f93c4a5…` exactly.
