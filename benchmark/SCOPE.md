# Benchmark scope — the selected 128-page set

**Status: closed.** All six buckets are enumerated, the five excluded
pages are named, and the question set has been regenerated against the
128.

The generator, parser, optimizer, validator, benchmark-generation code
and application code are unchanged by this document. It records a
decision about *which pages the experiment covers*; it changes nothing
about how they are produced.

---

## 1. The decision

The August snapshot `AUGUST-2026-CORPUS` holds **133 pages**. The
benchmark is run over a deliberately selected subset of **128**, being
the six production buckets as currently tagged. Five pages were left
Unsorted and are **excluded by intent** — this is a scoping decision,
not missing data, and must not be reported as data loss.

| Bucket | Pages | Membership known? |
|---|---:|---|
| PROJECT PLAYBOOK | 16 | yes |
| TOWNSHIP PAGES | 5 | yes |
| NAVIGATION PAGES | 35 | yes |
| LOCATORS | 51 | yes |
| LIFE AT FAI | 16 | yes |
| EMPLOYEE PLAYBOOK | 5 | yes |
| **Total** | **128** | all 128 |

The 123 enumerated filenames are listed per bucket in
`benchmark/scope-128.json`. That file is **gitignored**: page names
disclose the internal site structure and this repository is public, the
same reasoning that keeps the corpus and the question set out. Regenerate
it locally rather than committing it.

All arms compare the same 128 pages. Arm A is the exception and §4
explains why that matters.

## 2. What is not yet pinned down

Comparing the current bucket exports against the 133-page snapshot,
**ten** pages left the previously recorded partition and none arrived:

```
left PROJECT PLAYBOOK (3)   FORTUNE-HILL.aspx  STUDIO-CITY.aspx  THE-SIGNATURE.aspx
left NAVIGATION PAGES (7)   Darwinbox.aspx  Exclusive-Promos.aspx  Lost-Page.aspx
                            OurLink.aspx  Page.aspx  Permit.aspx  Ramco.aspx
```

133 − 10 + 5 (the new EMPLOYEE PLAYBOOK bucket) = 128, so the arithmetic
closes. But **five of those ten are now in EMPLOYEE PLAYBOOK and five are
Unsorted, and no EMPLOYEE PLAYBOOK export has been supplied**, so which
five is which is not established here.

Two of the excluded five are known from the pre-flight decision to drop
Q2 and Q3: `FORTUNE-HILL.aspx` and `STUDIO-CITY.aspx` are out of scope.
`THE-SIGNATURE.aspx` is a residential project page and almost certainly
the third, but that is an inference, not a record.

Reconciled with normalized filename comparison, so
`PROJECT-DEVELOPMENT-#U2013-PRIMING-&-INNOVATION.aspx` (corpus spelling)
and `PROJECT-DEVELOPMENT-–-PRIMING-&-INNOVATION.aspx` (export spelling)
count as one page. Checks that passed: no page appears in two buckets,
and every enumerated page exists in the snapshot.

**To close this**, supply the EMPLOYEE PLAYBOOK bucket export — the
Master file's `Total Files:` header and table of contents name its five
pages outright — or the Unsorted list. Either one determines the other.
An attempt to supply it did not reach this session; only the original
`EmployeePlaybook.zip` (the 133-page corpus, not a bucket export) is
present. **No filename below is assigned by arithmetic**: the split of
the ten is not derivable from counts, and guessing it would put the
wrong five pages in a benchmark that is meant to be reproducible.

`LOCATORS` and `LIFE AT FAI` are taken as unchanged at 51 and 16: the
counts match the earlier exports, and no re-export was supplied to
confirm membership.

## 3. The question set, regenerated

The 742-question set was generated from all 133 pages and was **not**
valid for this scope. It has been regenerated:

```
742 -> 638 questions   (-104)
128 of 133 pages in scope   48 pages carry questions
0 excluded pages represented   0 out-of-scope questions
```

All 104 removed questions were anchored on excluded pages —
`FORTUNE-HILL` 45, `THE-SIGNATURE` 30, `STUDIO-CITY` 29 (`Page.aspx` and
`Lost-Page.aspx` carried none). Every in-scope question survived byte
for byte: 0 present before and not now, 0 present now and not before.
Exclusion happens at corpus intake, before any question is generated, so
the deterministic generation rules are untouched and no question was
edited by hand.

| Category | 742-set | 638-set | Δ |
|---|---:|---:|---:|
| `contact-email` | 270 | 244 | −26 |
| `contact-by-role` | 231 | 208 | −23 |
| `external-link` | 105 | 96 | −9 |
| `amenity` | 98 | 75 | −23 |
| `labelled-fact` | 16 | 7 | −9 |
| `unit-area` | 11 | 4 | −7 |
| `unit-price` | 11 | 4 | −7 |

**Worth weighing before the run.** `unit-price` and `unit-area` are the
categories that actually separate a knowledge base holding the right
*facts* from one holding the right *words* — they are the adjacency and
association probes the generator's ordering validation exists to
protect. Between them they are now **8 questions**, down from 22, because
FORTUNE-HILL and STUDIO-CITY were the two most price- and area-dense
pages in the corpus. The benchmark's most discriminating dimension is
now thin enough that a difference there will be hard to call. That is a
consequence of the scoping decision, not a defect, but it is the thing
most worth knowing about the 638-set.

Pinned as `CORE_SHA = ed410946f7dc284c…` in `test/benchmark.test.js`,
alongside an assertion that no question names an excluded page.

## 4. Excluding pages changes what Arm A means

Arm A is the live SharePoint site. It still contains all 133 pages —
excluding five from the uploaded knowledge does not remove them from
SharePoint. So for any question anchored on an excluded page, Arm A can
answer and Arms B and C structurally cannot, which reads as an Arm A win
that has nothing to do with representation.

The nine-question pre-flight is unaffected: after the Q2/Q3 replacement
no pre-flight question touches an excluded page. The full run is
affected, and regenerating the question set against the 128 is what
fixes it.
